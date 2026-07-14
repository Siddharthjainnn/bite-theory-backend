import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
  Req, Headers, UseGuards, UnauthorizedException, RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import { RazorpayService } from './razorpay.service';
import { UserAuthGuard, verifyUserToken } from '../common/user-auth.guard';
import { RiderAuthGuard, riderIdFromReq, safeEqual } from '../common/rider-auth.guard';
import { AdminAuthGuard, Roles } from '../common/admin-auth.guard';
import { requireSelfOrAdmin } from '../common/req-auth.util';
import {
  CreateOrderDto, UpdateOrderDto, UpdateOrderStatusDto, CheckoutDto, CreatePaymentDto, CancelOrderDto,
  SetPrepVideoDto, RefundOrderDto,
} from './dto';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly service: OrdersService,
    private readonly razorpay: RazorpayService,
  ) {}

  /**
   * Razorpay → server webhook (register payment.captured in the dashboard).
   * Authenticity is the webhook signature over the RAW body — no user auth.
   */
  @Post('razorpay-webhook')
  razorpayWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    const raw = req.rawBody;
    if (!raw || !this.razorpay.verifyWebhookSignature(raw, signature || '')) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return this.service.handleRazorpayWebhook(JSON.parse(raw.toString('utf8')));
  }

  /** True when the request carries the server admin key (break-glass / admin panel). */
  private isAdmin(req: Request): boolean {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) return false;
    const header =
      (req.headers['x-admin-key'] as string) ||
      (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') || '';
    return !!header && safeEqual(header, expected);   // P1: constant-time
  }

  /** Enforce: token uid must exist (when enforcement is on) and match dto.userId. */
  private assertOwner(req: Request & { authUserId?: number }, userId: number) {
    if (process.env.USER_TOKEN_SECRET && !req.authUserId) {
      throw new UnauthorizedException('Please sign in again to continue.');
    }
    if (req.authUserId && Number(req.authUserId) !== Number(userId)) {
      throw new UnauthorizedException('Token does not match this user.');
    }
  }

  /* ═════════════ DOORSTEP UPI QR ═════════════ */

  /**
   * Rider: "customer wants to pay online" → mint a fixed-amount, single-use QR.
   * The amount is computed server-side from the order; the rider never sends it,
   * so a rider cannot mint a ₹1 QR for a ₹900 order and pocket the difference.
   */
  @UseGuards(RiderAuthGuard)
  @Post(':id/collect/qr')
  createQr(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { riderId?: number },
  ) {
    return this.service.createDoorstepQr(id, riderIdFromReq(req));
  }

  /**
   * Poll: has the money landed? The rider app hits this every ~3s while the QR
   * is on screen. Ownership-checked so a customer can watch it from their own
   * tracking page too.
   */
  @Get(':id/collect/status')
  async collectStatus(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    if (!this.isAdmin(req) && !riderIdFromReq(req)) {
      const order = await this.service.findOne(id);
      requireSelfOrAdmin(req, Number((order as any).userId));
    }
    return this.service.collectStatus(id);
  }

  /** Rider: customer changed their mind, taking cash. Kill the QR. */
  @UseGuards(RiderAuthGuard)
  @Post(':id/collect/cancel')
  cancelQr(@Param('id', ParseIntPipe) id: number) {
    return this.service.cancelDoorstepQr(id);
  }

  /** Customer cancels their own order (only before cooking starts). */
  @UseGuards(UserAuthGuard)
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelOrderDto,
    @Req() req: Request & { authUserId?: number },
  ) {
    this.assertOwner(req, Number(dto.userId));
    return this.service.cancelByCustomer(id, Number(dto.userId));
  }

  @Get() findAll(
    @Req() req: Request & { authUserId?: number },
    @Query('userId') userId?: string,
    @Query('deliveryPartnerId') deliveryPartnerId?: string,
    @Query('active') active?: string,
  ) {
    if (!this.isAdmin(req)) {
      // Non-admin reads must be scoped — never a full dump of every order.
      if (!userId && !deliveryPartnerId) {
        throw new UnauthorizedException('Admin key required to list all orders.');
      }
      // If user tokens are enforced, a userId-scoped read must belong to the caller.
      if (userId && process.env.USER_TOKEN_SECRET) {
        const uid = verifyUserToken((req.headers['x-user-token'] as string) || '');
        if (!uid || Number(uid) !== Number(userId)) {
          throw new UnauthorizedException('You can only view your own orders.');
        }
      }
    }
    return this.service.findAll({
      userId: userId ? Number(userId) : undefined,
      deliveryPartnerId: deliveryPartnerId ? Number(deliveryPartnerId) : undefined,
      active: active === 'true' || active === '1',
    });
  }

  /** DEPRECATED: self-accept disabled — always returns []. Kept so old rider clients don't 404. */
  @Get('available-for-riders') availableForRiders() { return this.service.availableForRiders(); }

  /**
   * Admin assigns a SPECIFIC rider to an order (admin-only dispatch).
   * Rider self-accept has been removed.
   */
  @Patch(':id/assign-rider')
  assignRider(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { partnerId: number },
    @Req() req: Request,
  ) {
    if (!this.isAdmin(req)) throw new UnauthorizedException('Admin key required.');
    return this.service.assignRider(id, Number(body.partnerId));
  }
  /** Admin attaches / clears a "your food being made" clip on an order. */
  @Patch(':id/prep-video')
  setPrepVideo(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetPrepVideoDto,
    @Req() req: Request,
  ) {
    if (!this.isAdmin(req)) throw new UnauthorizedException('Admin key required.');
    return this.service.setPrepVideo(id, dto.prepVideoUrl ?? null);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { authUserId?: number }) {
    const uid = this.isAdmin(req)
      ? undefined
      : verifyUserToken((req.headers['x-user-token'] as string) || '');
    return this.service.findOneFullOwned(id, this.isAdmin(req), uid ?? null);
  }
  /** P0 patch: history is ownership-checked like :id and :id/track. */
  @Get(':id/history')
  async getHistory(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    if (!this.isAdmin(req)) {
      const order = await this.service.findOne(id);
      requireSelfOrAdmin(req, Number((order as any).userId));
    }
    return this.service.getHistory(id);
  }
  @Get(':id/track')
  track(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { authUserId?: number }) {
    const uid = this.isAdmin(req)
      ? undefined
      : verifyUserToken((req.headers['x-user-token'] as string) || '');
    return this.service.trackOwned(id, this.isAdmin(req), uid ?? null);
  }

  /** P0 patch: your protein streak is your data — self or admin only. */
  @Get('streak/:userId')
  streak(@Param('userId', ParseIntPipe) userId: number, @Req() req: Request) {
    requireSelfOrAdmin(req, userId);
    return this.service.streak(userId);
  }

  /** Customer checkout — items priced server-side, atomic. */
  @UseGuards(UserAuthGuard)
  @Post('checkout')
  checkout(@Body() dto: CheckoutDto, @Req() req: Request & { authUserId?: number }) {
    this.assertOwner(req, Number(dto.userId));
    return this.service.checkout(dto);
  }

  /** Online pay step 1: price cart + open a Razorpay order (nothing saved yet). */
  @UseGuards(UserAuthGuard)
  @Post('create-payment')
  createPayment(@Body() dto: CreatePaymentDto, @Req() req: Request & { authUserId?: number }) {
    this.assertOwner(req, Number(dto.userId));
    return this.service.createPaymentOrder(dto);
  }

  /**
   * P0-2: this route used to be PUBLIC (it sat in AdminWriteGuard's allow-list
   * as "place order") while accepting a client-supplied userId, subtotal and
   * total. Anyone could POST a ₹0 order for any user, or flood the kitchen
   * queue with fake tickets. Customers place orders via /checkout, which
   * prices everything server-side. This is now admin-only.
   */
  @UseGuards(AdminAuthGuard)
  @Post() create(@Body() dto: CreateOrderDto) { return this.service.create(dto); }

  /**
   * P0-1: the ONLY post-delivery refund path. Deliberate, admin-only, audited.
   * Replaces the old `delivered -> cancelled` trick that refunded eaten food.
   */
  @UseGuards(AdminAuthGuard)
  @Roles('super_admin')
  @Post(':id/refund')
  refund(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RefundOrderDto,
  ) {
    return this.service.adminRefund(id, dto.reason, dto.amount);
  }

  @UseGuards(AdminAuthGuard)
  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) { return this.service.update(id, dto); }
  /**
   * P0-1: was an UNAUTHENTICATED public write whose only credential was
   * dto.deliveryPartnerId — a sequential integer we hand to every customer in
   * the /track payload. Now it needs a signed rider token, and the rider id is
   * read FROM THE TOKEN, never from the body.
   */
  @UseGuards(RiderAuthGuard)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @Req() req: Request & { riderId?: number },
  ) {
    // admin panel can force any status without OTP/geofence
    return this.service.updateStatus(
      id, dto, this.isAdmin(req), false, riderIdFromReq(req),
    );
  }
  @UseGuards(AdminAuthGuard)
  @Roles('super_admin')
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

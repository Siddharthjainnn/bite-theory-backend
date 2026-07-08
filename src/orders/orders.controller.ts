import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
  Req, Headers, UseGuards, UnauthorizedException, RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import { RazorpayService } from './razorpay.service';
import { UserAuthGuard, verifyUserToken } from '../common/user-auth.guard';
import {
  CreateOrderDto, UpdateOrderDto, UpdateOrderStatusDto, CheckoutDto, CreatePaymentDto, CancelOrderDto,
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
    return header === expected;
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

  /** Rider feed: unclaimed orders ready for pickup. */
  @Get('available-for-riders') availableForRiders() { return this.service.availableForRiders(); }

  /** Rider claims an order (first-come-first-served, atomic). */
  @Post(':id/accept')
  accept(@Param('id', ParseIntPipe) id: number, @Body() body: { partnerId: number }) {
    return this.service.acceptOrder(id, Number(body.partnerId));
  }
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { authUserId?: number }) {
    const uid = this.isAdmin(req)
      ? undefined
      : verifyUserToken((req.headers['x-user-token'] as string) || '');
    return this.service.findOneFullOwned(id, this.isAdmin(req), uid ?? null);
  }
  @Get(':id/history') getHistory(@Param('id', ParseIntPipe) id: number) { return this.service.getHistory(id); }
  @Get(':id/track')
  track(@Param('id', ParseIntPipe) id: number, @Req() req: Request & { authUserId?: number }) {
    const uid = this.isAdmin(req)
      ? undefined
      : verifyUserToken((req.headers['x-user-token'] as string) || '');
    return this.service.trackOwned(id, this.isAdmin(req), uid ?? null);
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

  /** Legacy admin create. */
  @Post() create(@Body() dto: CreateOrderDto) { return this.service.create(dto); }

  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) { return this.service.update(id, dto); }
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @Req() req: Request,
  ) {
    // admin panel can force any status without OTP/geofence
    return this.service.updateStatus(id, dto, this.isAdmin(req));
  }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

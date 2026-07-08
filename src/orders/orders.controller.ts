import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
  Req, Headers, UseGuards, UnauthorizedException, RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import { RazorpayService } from './razorpay.service';
import { UserAuthGuard } from '../common/user-auth.guard';
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

  /** Customer cancels their own order (only before cooking starts). */
  @UseGuards(UserAuthGuard)
  @Post(':id/cancel')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelOrderDto,
    @Req() req: Request & { authUserId?: number },
  ) {
    // When USER_TOKEN_SECRET is set, the token's uid must match the body.
    if (req.authUserId && Number(req.authUserId) !== Number(dto.userId)) {
      throw new UnauthorizedException('Token does not match this user.');
    }
    return this.service.cancelByCustomer(id, Number(dto.userId));
  }

  @Get() findAll(
    @Query('userId') userId?: string,
    @Query('deliveryPartnerId') deliveryPartnerId?: string,
    @Query('active') active?: string,
  ) {
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
  @Get(':id') findOne(@Param('id', ParseIntPipe) id: number) { return this.service.findOneFull(id); }
  @Get(':id/history') getHistory(@Param('id', ParseIntPipe) id: number) { return this.service.getHistory(id); }
  @Get(':id/track') track(@Param('id', ParseIntPipe) id: number) { return this.service.track(id); }

  /** Customer checkout — items priced server-side, atomic. */
  @UseGuards(UserAuthGuard)
  @Post('checkout')
  checkout(@Body() dto: CheckoutDto, @Req() req: Request & { authUserId?: number }) {
    if (req.authUserId && Number(req.authUserId) !== Number(dto.userId)) {
      throw new UnauthorizedException('Token does not match this user.');
    }
    return this.service.checkout(dto);
  }

  /** Online pay step 1: price cart + open a Razorpay order (nothing saved yet). */
  @UseGuards(UserAuthGuard)
  @Post('create-payment')
  createPayment(@Body() dto: CreatePaymentDto, @Req() req: Request & { authUserId?: number }) {
    if (req.authUserId && Number(req.authUserId) !== Number(dto.userId)) {
      throw new UnauthorizedException('Token does not match this user.');
    }
    return this.service.createPaymentOrder(dto);
  }

  /** Legacy admin create. */
  @Post() create(@Body() dto: CreateOrderDto) { return this.service.create(dto); }

  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) { return this.service.update(id, dto); }
  @Patch(':id/status') updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderStatusDto) { return this.service.updateStatus(id, dto); }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

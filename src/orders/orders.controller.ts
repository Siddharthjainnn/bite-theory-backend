import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import {
  CreateOrderDto, UpdateOrderDto, UpdateOrderStatusDto, CheckoutDto,
} from './dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

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
  @Post('checkout') checkout(@Body() dto: CheckoutDto) { return this.service.checkout(dto); }

  /** Legacy admin create. */
  @Post() create(@Body() dto: CreateOrderDto) { return this.service.create(dto); }

  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) { return this.service.update(id, dto); }
  @Patch(':id/status') updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderStatusDto) { return this.service.updateStatus(id, dto); }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

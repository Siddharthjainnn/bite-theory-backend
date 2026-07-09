import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeliveryPartnerService } from './delivery_partners.service';
import { CreateDeliveryPartnerDto } from './create-delivery-partner.dto';
import { UpdateDeliveryPartnerDto } from './update-delivery-partner.dto';

@Controller('delivery-partners')
export class DeliveryPartnerController {
  constructor(private readonly service: DeliveryPartnerService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** Rider portal login: mobile number + shared access code. */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  login(@Body() body: { mobile: string; code?: string }) {
    return this.service.login((body.mobile || '').trim(), (body.code || '').trim());
  }

  /** Admin dispatch picker: active riders + availability + current load. */
  @Get('for-assignment')
  forAssignment() {
    return this.service.forAssignment();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  /** Rider dashboard: today/week earnings, COD cash-in-hand, delivery history. */
  @Get(':id/earnings')
  earnings(@Param('id', ParseIntPipe) id: number) {
    return this.service.earnings(id);
  }

  /** Admin records COD cash deposited by the rider (admin key required —
      POST routes not on the public whitelist are guarded globally). */
  @Post(':id/deposits')
  recordDeposit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { amount: number; note?: string },
  ) {
    return this.service.recordDeposit(id, Number(body.amount), body.note);
  }

  @Post()
  create(@Body() dto: CreateDeliveryPartnerDto) {
    return this.service.create(dto);
  }

  /** Rider app / admin pings live location here. */
  @Patch(':id/location')
  updateLocation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { lat: number; lng: number },
  ) {
    return this.service.updateLocation(id, Number(body.lat), Number(body.lng));
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDeliveryPartnerDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { RiderAuthGuard, riderIdFromReq } from '../common/rider-auth.guard';
import { AdminAuthGuard, Roles } from '../common/admin-auth.guard';
import { DeliveryPartnerService } from './delivery_partners.service';
import { CreateDeliveryPartnerDto } from './create-delivery-partner.dto';
import { UpdateDeliveryPartnerDto } from './update-delivery-partner.dto';

@Controller('delivery-partners')
export class DeliveryPartnerController {
  constructor(private readonly service: DeliveryPartnerService) {}

  /** P1: this published every rider's name + mobile number to anyone. Admin only. */
  @UseGuards(AdminAuthGuard)
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
  /**
   * Owner's morning screen: who is holding my money, and for how long.
   * Sorted worst-first — the problem rider is always row one.
   */
  @UseGuards(AdminAuthGuard)
  @Get('reconciliation')
  reconciliation() {
    return this.service.reconciliation();
  }

  @UseGuards(AdminAuthGuard)
  @Get('for-assignment')
  forAssignment() {
    return this.service.forAssignment();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  /** Rider dashboard: today/week earnings, COD cash-in-hand, delivery history. */
  @UseGuards(RiderAuthGuard)
  @Get(':id/earnings')
  earnings(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    // P1: was public — anyone could read any rider's income and COD cash-in-hand.
    this.service.assertSelf(riderIdFromReq(req), id);
    return this.service.earnings(id);
  }

  /** Admin records COD cash deposited by the rider (admin key required —
      POST routes not on the public whitelist are guarded globally). */
  @UseGuards(AdminAuthGuard)
  @Post(':id/deposits')
  recordDeposit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { amount: number; note?: string },
  ) {
    return this.service.recordDeposit(id, Number(body.amount), body.note);
  }

  @UseGuards(AdminAuthGuard)
  @Post()
  create(@Body() dto: CreateDeliveryPartnerDto) {
    return this.service.create(dto);
  }

  /**
   * P0-3: was a PUBLIC write keyed on the rider's sequential id — anyone could
   * teleport any rider on the customer's live map, and thereby walk through the
   * 150m delivery geofence. Now requires a signed rider token, and you may only
   * move yourself.
   */
  @UseGuards(RiderAuthGuard)
  @Patch(':id/location')
  updateLocation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { lat: number; lng: number },
    @Req() req: Request,
  ) {
    this.service.assertSelf(riderIdFromReq(req), id);
    return this.service.updateLocation(id, Number(body.lat), Number(body.lng));
  }

  @UseGuards(AdminAuthGuard)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDeliveryPartnerDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(AdminAuthGuard)
  @Roles('super_admin')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

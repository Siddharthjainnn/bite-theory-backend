import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
} from '@nestjs/common';
import { ReferralService } from './referrals.service';
import { CreateReferralDto } from './create-referral.dto';
import { UpdateReferralDto } from './update-referral.dto';

@Controller('referrals')
export class ReferralController {
  constructor(private readonly service: ReferralService) {}

  @Get()
  findAll(@Query('referrerId') referrerId?: string) {
    return this.service.findAll(referrerId ? Number(referrerId) : undefined);
  }

  /** A new user enters a friend's referral code (public write, guard-allow-listed). */
  @Post('claim')
  claim(@Body() body: { userId: number; code: string }) {
    return this.service.claim(Number(body.userId), String(body.code || ''));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateReferralDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReferralDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

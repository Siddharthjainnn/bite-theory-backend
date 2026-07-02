import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe,
} from '@nestjs/common';
import { CouponService } from './coupons.service';
import { ValidateCouponDto } from './validate-coupon.dto';
import { CreateCouponDto } from './create-coupon.dto';
import { UpdateCouponDto } from './update-coupon.dto';

@Controller('coupons')
export class CouponController {
  constructor(private readonly service: CouponService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** Customer-facing: validate a code against a cart subtotal. */
  @Post('validate')
  validate(@Body() dto: ValidateCouponDto) {
    return this.service.validate(dto.code, dto.subtotal);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCouponDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCouponDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

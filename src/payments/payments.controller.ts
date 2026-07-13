import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payments.service';
import { CreatePaymentDto } from './create-payment.dto';
import { UpdatePaymentDto } from './update-payment.dto';
import { requireAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — payment rows (amounts, transaction ids) are admin-only.
 * Customers see their payment info through GET /orders/:id, which is already
 * ownership-checked. Payment rows are only ever CREATED inside the checkout
 * transaction — never through this controller.
 */
@Controller('payments')
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  @Get()
  findAll(@Req() req: Request) {
    requireAdmin(req);
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePaymentDto, @Req() req: Request) {
    requireAdmin(req);
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentDto,
    @Req() req: Request,
  ) {
    requireAdmin(req);
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.remove(id);
  }
}

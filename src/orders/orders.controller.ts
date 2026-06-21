import { Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto, UpdateOrderStatusDto } from './dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Get() findAll() { return this.service.findAll(); }
  @Get(':id') findOne(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Get(':id/history') getHistory(@Param('id', ParseIntPipe) id: number) { return this.service.getHistory(id); }
  @Post() create(@Body() dto: CreateOrderDto) { return this.service.create(dto); }
  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) { return this.service.update(id, dto); }
  @Patch(':id/status') updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderStatusDto) { return this.service.updateStatus(id, dto); }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}
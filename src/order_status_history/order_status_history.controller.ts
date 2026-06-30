import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe,
} from '@nestjs/common';
import { OrderStatusHistoryService } from './order_status_history.service';
import { CreateOrderStatusHistoryDto } from './create-order-status-history.dto';
import { UpdateOrderStatusHistoryDto } from './update-order-status-history.dto';

@Controller('order-status-history')
export class OrderStatusHistoryController {
  constructor(private readonly service: OrderStatusHistoryService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateOrderStatusHistoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderStatusHistoryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

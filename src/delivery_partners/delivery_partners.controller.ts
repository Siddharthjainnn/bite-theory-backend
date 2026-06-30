import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe,
} from '@nestjs/common';
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

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDeliveryPartnerDto) {
    return this.service.create(dto);
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

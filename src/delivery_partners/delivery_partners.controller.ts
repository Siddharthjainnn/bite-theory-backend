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

  /** Rider portal login: mobile number + shared access code. */
  @Post('login')
  login(@Body() body: { mobile: string; code?: string }) {
    return this.service.login((body.mobile || '').trim(), (body.code || '').trim());
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
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

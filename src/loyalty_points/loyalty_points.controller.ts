import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe,
} from '@nestjs/common';
import { LoyaltyPointService } from './loyalty_points.service';
import { CreateLoyaltyPointDto } from './create-loyalty-point.dto';
import { UpdateLoyaltyPointDto } from './update-loyalty-point.dto';

@Controller('loyalty-points')
export class LoyaltyPointController {
  constructor(private readonly service: LoyaltyPointService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateLoyaltyPointDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLoyaltyPointDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

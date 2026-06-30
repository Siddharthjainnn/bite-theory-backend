import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe,
} from '@nestjs/common';
import { CampaignService } from './campaigns.service';
import { CreateCampaignDto } from './create-campaign.dto';
import { UpdateCampaignDto } from './update-campaign.dto';

@Controller('campaigns')
export class CampaignController {
  constructor(private readonly service: CampaignService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCampaignDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCampaignDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

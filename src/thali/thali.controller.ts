import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe,
} from '@nestjs/common';
import { ThaliService } from './thali.service';
import {
  CreateThaliTemplateDto, CreateThaliSectionDto, CreateThaliOptionDto,
  PriceCheckDto,
} from './create-thali.dto';
import {
  UpdateThaliTemplateDto, UpdateThaliSectionDto, UpdateThaliOptionDto,
} from './update-thali.dto';

/**
 * GETs are public (global AdminWriteGuard allows reads).
 * All writes require the admin key — EXCEPT price-check, which is
 * allow-listed in AdminWriteGuard as a customer-facing, read-effect call.
 */
@Controller('thali-templates')
export class ThaliController {
  constructor(private readonly service: ThaliService) {}

  @Get()
  findAllPublic() {
    return this.service.findAllPublic();
  }

  @Get('admin')
  findAllAdmin() {
    return this.service.findAllAdmin();
  }

  @Post(':id/price-check')
  priceCheck(@Param('id', ParseIntPipe) id: number, @Body() dto: PriceCheckDto) {
    return this.service.priceCheck(id, dto.selections || []);
  }

  /* templates */
  @Post()
  createTemplate(@Body() dto: CreateThaliTemplateDto) {
    return this.service.createTemplate(dto);
  }
  @Patch(':id')
  updateTemplate(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateThaliTemplateDto) {
    return this.service.updateTemplate(id, dto);
  }
  @Delete(':id')
  removeTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeTemplate(id);
  }

  /* sections */
  @Post('sections')
  createSection(@Body() dto: CreateThaliSectionDto) {
    return this.service.createSection(dto);
  }
  @Patch('sections/:id')
  updateSection(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateThaliSectionDto) {
    return this.service.updateSection(id, dto);
  }
  @Delete('sections/:id')
  removeSection(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeSection(id);
  }

  /* options */
  @Post('options')
  createOption(@Body() dto: CreateThaliOptionDto) {
    return this.service.createOption(dto);
  }
  @Patch('options/:id')
  updateOption(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateThaliOptionDto) {
    return this.service.updateOption(id, dto);
  }
  @Delete('options/:id')
  removeOption(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeOption(id);
  }
}

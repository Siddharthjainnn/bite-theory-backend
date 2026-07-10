import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, Query,
} from '@nestjs/common';
import { SupportTicketService } from './support_tickets.service';
import { CreateSupportTicketDto } from './create-support-ticket.dto';
import { UpdateSupportTicketDto } from './update-support-ticket.dto';

@Controller('support-tickets')
export class SupportTicketController {
  constructor(private readonly service: SupportTicketService) {}

  @Get()
  findAll(@Query('userId') userId?: string) {
    return this.service.findAll(userId ? Number(userId) : undefined);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSupportTicketDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupportTicketDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, Query,
  Req, UseGuards, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SupportTicketService } from './support_tickets.service';
import { CreateSupportTicketDto } from './create-support-ticket.dto';
import { UpdateSupportTicketDto } from './update-support-ticket.dto';
import { UserAuthGuard } from '../common/user-auth.guard';
import { isAdminReq, requireAdmin, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — tickets contain complaints, refund details, contact info.
 *   GET  /support-tickets?userId=X → self or admin (userId required unless admin)
 *   POST /support-tickets          → signed-in user; userId forced from token
 *   PATCH/DELETE/:id               → admin
 */
@Controller('support-tickets')
export class SupportTicketController {
  constructor(private readonly service: SupportTicketService) {}

  @Get()
  findAll(@Req() req: Request, @Query('userId') userId?: string) {
    if (isAdminReq(req)) {
      return this.service.findAll(userId ? Number(userId) : undefined);
    }
    if (!userId) {
      throw new UnauthorizedException('Admin key required to list all tickets.');
    }
    requireSelfOrAdmin(req, Number(userId));
    return this.service.findAll(Number(userId));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.findOne(id);
  }

  @UseGuards(UserAuthGuard)
  @Post()
  create(
    @Body() dto: CreateSupportTicketDto,
    @Req() req: Request & { authUserId?: number },
  ) {
    if (req.authUserId) (dto as any).userId = req.authUserId;
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSupportTicketDto,
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

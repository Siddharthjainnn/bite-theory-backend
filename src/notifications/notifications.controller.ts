import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe, Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { NotificationService } from './notifications.service';
import { CreateNotificationDto } from './create-notification.dto';
import { UpdateNotificationDto } from './update-notification.dto';
import { isAdminReq, requireAdmin, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — a user's notifications reveal their order history.
 *   GET /notifications?userId=X → self or admin (userId required unless admin)
 *   everything else             → admin
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  findAll(@Req() req: Request, @Query('userId') userId?: string) {
    if (isAdminReq(req)) {
      return this.service.findAll(userId ? Number(userId) : undefined);
    }
    if (!userId) {
      throw new UnauthorizedException('Admin key required to list all notifications.');
    }
    requireSelfOrAdmin(req, Number(userId));
    return this.service.findAll(Number(userId));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateNotificationDto, @Req() req: Request) {
    requireAdmin(req);
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateNotificationDto,
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

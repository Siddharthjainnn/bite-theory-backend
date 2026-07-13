import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe, Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { LoyaltyPointService } from './loyalty_points.service';
import { CreateLoyaltyPointDto } from './create-loyalty-point.dto';
import { UpdateLoyaltyPointDto } from './update-loyalty-point.dto';
import { isAdminReq, requireAdmin, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — points history is per-user data.
 *   GET /loyalty-points?userId=X        → self or admin (userId required unless admin)
 *   GET /loyalty-points/summary?userId= → self or admin
 *   everything else                     → admin
 */
@Controller('loyalty-points')
export class LoyaltyPointController {
  constructor(private readonly service: LoyaltyPointService) {}

  @Get()
  findAll(@Req() req: Request, @Query('userId') userId?: string) {
    if (isAdminReq(req)) {
      return this.service.findAll(userId ? Number(userId) : undefined);
    }
    if (!userId) {
      throw new UnauthorizedException('Admin key required to list all loyalty points.');
    }
    requireSelfOrAdmin(req, Number(userId));
    return this.service.findAll(Number(userId));
  }

  @Get('summary')
  summary(@Req() req: Request, @Query('userId', ParseIntPipe) userId: number) {
    requireSelfOrAdmin(req, userId);
    return this.service.summary(userId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateLoyaltyPointDto, @Req() req: Request) {
    requireAdmin(req);
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLoyaltyPointDto,
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

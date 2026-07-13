import {
  Controller, Get, Post, Delete, Param, Body, Query, ParseIntPipe, Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { CouponAssignmentsService } from './coupon_assignments.service';
import { CreateCouponAssignmentDto } from './dto';
import { isAdminReq, requireAdmin, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — gifted-coupon reads are now scoped.
 *   GET /coupon-assignments?userId=X[&mine=1] → self or admin
 *   GET /coupon-assignments                   → admin
 *   POST / DELETE                             → admin (already key-gated)
 */
@Controller('coupon-assignments')
export class CouponAssignmentsController {
  constructor(private readonly service: CouponAssignmentsService) {}

  @Get()
  findAll(
    @Req() req: Request,
    @Query('userId') userId?: string,
    @Query('mine') mine?: string,
  ) {
    if (!userId) {
      if (!isAdminReq(req)) {
        throw new UnauthorizedException('Admin key required to list all assignments.');
      }
      return this.service.findAll({ userId: undefined });
    }
    requireSelfOrAdmin(req, Number(userId));
    if (mine === '1' || mine === 'true') {
      return this.service.activeForUser(Number(userId));
    }
    return this.service.findAll({ userId: Number(userId) });
  }

  @Post()
  create(@Body() dto: CreateCouponAssignmentDto, @Req() req: Request) {
    requireAdmin(req);
    return this.service.create(dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.remove(id);
  }
}

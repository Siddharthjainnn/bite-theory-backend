import {
  Controller, Get, Post, Delete, Param, Body, Query, ParseIntPipe,
} from '@nestjs/common';
import { CouponAssignmentsService } from './coupon_assignments.service';
import { CreateCouponAssignmentDto } from './dto';

@Controller('coupon-assignments')
export class CouponAssignmentsController {
  constructor(private readonly service: CouponAssignmentsService) {}

  /**
   * GET /coupon-assignments            → admin list (all)
   * GET /coupon-assignments?userId=42  → coupons gifted to a specific user
   * GET /coupon-assignments?userId=42&mine=1 → customer's unused gifts only
   *
   * Non-GET routes are already protected by the global AdminWriteGuard.
   */
  @Get()
  findAll(@Query('userId') userId?: string, @Query('mine') mine?: string) {
    if (userId && (mine === '1' || mine === 'true')) {
      return this.service.activeForUser(Number(userId));
    }
    return this.service.findAll({ userId: userId ? Number(userId) : undefined });
  }

  @Post()
  create(@Body() dto: CreateCouponAssignmentDto) {
    return this.service.create(dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

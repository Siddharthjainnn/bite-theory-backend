import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CouponAssignment } from './coupon-assignment.entity';
import { Coupon } from '../coupons/coupon.entity';
import { CouponAssignmentsService } from './coupon_assignments.service';
import { CouponAssignmentsController } from './coupon_assignments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CouponAssignment, Coupon])],
  controllers: [CouponAssignmentsController],
  providers: [CouponAssignmentsService],
  exports: [CouponAssignmentsService],
})
export class CouponAssignmentsModule {}

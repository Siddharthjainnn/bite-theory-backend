import { IsNumber, IsOptional, IsString, MaxLength, IsBoolean } from 'class-validator';

export class CreateCouponAssignmentDto {
  @IsNumber() couponId!: number;
  @IsNumber() userId!: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /** Email the coupon to the customer as well as assigning it. */
  @IsOptional() @IsBoolean() sendEmail?: boolean;
}

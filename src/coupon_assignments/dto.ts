import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCouponAssignmentDto {
  @IsNumber() couponId!: number;
  @IsNumber() userId!: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

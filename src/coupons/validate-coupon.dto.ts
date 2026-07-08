import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';

export class ValidateCouponDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsNumber() @Min(0) subtotal!: number;
  /** Needed so "already used this coupon" shows at apply time.
      Without the decorator, whitelist:true strips it silently. */
  @IsOptional() @IsNumber() userId?: number;
}

import {
  IsOptional,
  IsString,
  IsNumber,
  IsDateString,
  IsBoolean,
  IsNotEmpty,
  IsIn,
  Min,
  Max,
  Length,
} from 'class-validator';

/**
 * Fixes bug #43 (no limits on coupon fields) and the root cause of bug #46
 * (customer can't apply an admin-made coupon).
 *
 * Why this fixes #46: computeCouponDiscount() defaults discountType to
 * 'percentage' and treats a null/0 discountValue as "no discount", so a coupon
 * created without those fields validates to `discount <= 0` →
 * "Coupon gives no discount on this order". By making code, discountType and
 * discountValue REQUIRED and bounded, an admin can no longer save a coupon that
 * is structurally un-applyable.
 *
 *  - code            required, 3–20 chars, upper-cased in the service
 *  - discountType    required, must be 'percentage' | 'flat'
 *  - discountValue   required, >0; if percentage, capped at 100 (no >100% off)
 *  - minOrder / maxDiscount / usageLimit / perUserLimit  >= 0
 *  - usedCount is NOT accepted from the client (server-owned) — removed.
 */
export class CreateCouponDto {
  @IsString()
  @IsNotEmpty({ message: 'Coupon code is required' })
  @Length(3, 20, { message: 'Code must be 3–20 characters' })
  code!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  description?: string;

  @IsString()
  @IsIn(['percentage', 'flat', 'fixed'], {
    message: "discountType must be 'percentage' or 'flat'",
  })
  discountType!: string;

  @IsNumber()
  @Min(1, { message: 'Discount value must be greater than 0' })
  discountValue!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrder?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000, { message: 'Usage limit is unrealistically large' })
  usageLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  perUserLimit?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: Date;

  @IsOptional()
  @IsDateString()
  validUntil?: Date;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /* Bug #69: only admin-flagged coupons are advertised on the storefront. */
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

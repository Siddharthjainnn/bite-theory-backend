import {
  IsOptional, IsNumber, Min, IsBoolean, IsString, IsObject, IsArray,
} from 'class-validator';
import { WeeklyHours, Holiday } from './settings.entity';

/**
 * IMPORTANT: main.ts uses ValidationPipe({ whitelist: true }), which STRIPS
 * any property that has no class-validator decorator. Every field here MUST
 * be decorated, or the PATCH body arrives empty at the service and only
 * updated_at changes (values silently stay the same).
 */
export class UpdateSettingsDto {
  @IsOptional() @IsNumber() @Min(0)
  deliveryCharge?: number;

  @IsOptional() @IsNumber() @Min(0)
  freeDeliveryAbove?: number;

  @IsOptional() @IsNumber() @Min(0)
  minOrderAmount?: number;

  @IsOptional() @IsNumber() @Min(0)
  maxOrderAmount?: number;

  @IsOptional() @IsObject()
  weeklyHours?: WeeklyHours;

  @IsOptional() @IsArray()
  holidays?: Holiday[];

  @IsOptional() @IsBoolean()
  forceClosed?: boolean;

  @IsOptional() @IsString()
  closedMessage?: string;

  @IsOptional() @IsString()
  timezone?: string;

  /* store location + distance pricing */
  @IsOptional() @IsNumber() storeLat?: number;
  @IsOptional() @IsNumber() storeLng?: number;
  @IsOptional() @IsString() storeAddress?: string;
  @IsOptional() @IsNumber() @Min(0) deliveryRadiusKm?: number;
  @IsOptional() @IsNumber() @Min(0) avgPrepMinutes?: number;
  @IsOptional() @IsNumber() @Min(1) avgRiderKmph?: number;
  @IsOptional() @IsNumber() @Min(0) baseDeliveryCharge?: number;
  @IsOptional() @IsNumber() @Min(0) perKmCharge?: number;
  @IsOptional() @IsNumber() @Min(0) freeDeliveryWithinKm?: number;
  @IsOptional() @IsNumber() @Min(0) riderBaseFare?: number;
  @IsOptional() @IsNumber() @Min(0) riderPerKmPay?: number;
}

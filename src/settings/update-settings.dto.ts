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
}

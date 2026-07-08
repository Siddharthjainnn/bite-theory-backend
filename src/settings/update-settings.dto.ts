import { WeeklyHours, Holiday } from './settings.entity';

export class UpdateSettingsDto {
  deliveryCharge?: number;
  freeDeliveryAbove?: number;
  minOrderAmount?: number;
  maxOrderAmount?: number;
  weeklyHours?: WeeklyHours;
  holidays?: Holiday[];
  forceClosed?: boolean;
  closedMessage?: string;
  timezone?: string;
}

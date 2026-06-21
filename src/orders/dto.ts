import { IsString, IsNotEmpty, IsNumber, IsOptional, IsIn } from 'class-validator';
const STATUSES = ['order_received', 'order_confirmed', 'preparing_food', 'food_ready',
  'assigned_to_delivery', 'out_for_delivery', 'arriving_soon', 'delivered', 'cancelled'];
export class CreateOrderDto {
  @IsString() @IsNotEmpty() orderNumber!: string;
  @IsNumber() userId!: number;
  @IsOptional() @IsNumber() addressId?: number;
  @IsOptional() @IsNumber() couponId?: number;
  @IsNumber() subtotal!: number;
  @IsOptional() @IsNumber() discount?: number;
  @IsOptional() @IsNumber() deliveryCharge?: number;
  @IsOptional() @IsNumber() tax?: number;
  @IsOptional() @IsNumber() walletUsed?: number;
  @IsNumber() total!: number;
  @IsOptional() @IsString() deliverySlot?: string;
}

export class UpdateOrderDto {
  @IsOptional() @IsNumber() addressId?: number;
  @IsOptional() @IsString() deliverySlot?: string;
  @IsOptional() @IsNumber() deliveryPartnerId?: number;
}

export class UpdateOrderStatusDto {
  @IsIn(STATUSES) status!: string;
  @IsOptional() @IsString() note?: string;
}
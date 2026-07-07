import {
  IsString, IsNotEmpty, IsNumber, IsOptional, IsIn, IsArray,
  ValidateNested, Min, IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export const ORDER_STATUSES = ['order_received', 'order_confirmed', 'preparing_food', 'food_ready',
  'assigned_to_delivery', 'out_for_delivery', 'arriving_soon', 'delivered', 'cancelled'];

export class CheckoutItemDto {
  @IsNumber() productId!: number;
  @IsNumber() @Min(1) quantity!: number;
}

/** Swiggy-style checkout: server computes prices, discount, totals. */
export class CheckoutDto {
  @IsNumber() userId!: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];

  @IsOptional() @IsNumber() addressId?: number;
  @IsOptional() @IsString() deliveryAddress?: string;
  @IsOptional() @IsNumber() deliveryLat?: number;
  @IsOptional() @IsNumber() deliveryLng?: number;

  @IsOptional() @IsString() couponCode?: string;
  @IsOptional() @IsBoolean() useWallet?: boolean;
  @IsOptional() @IsIn(['cod', 'online']) paymentMethod?: string;
  @IsOptional() @IsString() deliverySlot?: string;

  // Razorpay (only sent when paymentMethod === 'online', after the popup succeeds)
  @IsOptional() @IsString() razorpayOrderId?: string;
  @IsOptional() @IsString() razorpayPaymentId?: string;
  @IsOptional() @IsString() razorpaySignature?: string;
}

/** Step 1 of online pay: price the cart and open a Razorpay order. */
export class CreatePaymentDto {
  @IsNumber() userId!: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CheckoutItemDto)
  items!: CheckoutItemDto[];
  @IsOptional() @IsNumber() addressId?: number;
  @IsOptional() @IsString() couponCode?: string;
  @IsOptional() @IsBoolean() useWallet?: boolean;
}

/** Legacy admin create (kept for admin panel compatibility). */
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
  @IsOptional() @IsNumber() etaMinutes?: number;
}

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES) status!: string;
  @IsOptional() @IsString() note?: string;
}

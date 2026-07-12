import {
  IsString, IsNotEmpty, IsNumber, IsOptional, IsIn, IsArray,
  ValidateNested, Min, Max, IsBoolean, MaxLength,
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

  // UX extras
  @IsOptional() @IsNumber() @Min(0) @Max(500) tipAmount?: number;
  @IsOptional() @IsString() @MaxLength(300) deliveryInstructions?: string;
  @IsOptional() @IsString() @MaxLength(300) cookingNote?: string;

  // Customized thalis (portion model) — priced & validated server-side
  @IsOptional() @IsArray()
  thaliItems?: { templateId: number; selections: { optionId: number; qty: number }[] }[];

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
  @IsOptional() @IsArray()
  thaliItems?: { templateId: number; selections: { optionId: number; qty: number }[] }[];
  @IsOptional() @IsNumber() addressId?: number;
  @IsOptional() @IsString() couponCode?: string;
  @IsOptional() @IsBoolean() useWallet?: boolean;

  // Full destination + extras are snapshotted so the webhook can finish
  // checkout even if the browser dies right after payment.
  @IsOptional() @IsString() deliveryAddress?: string;
  @IsOptional() @IsNumber() deliveryLat?: number;
  @IsOptional() @IsNumber() deliveryLng?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(500) tipAmount?: number;
  @IsOptional() @IsString() @MaxLength(300) deliveryInstructions?: string;
  @IsOptional() @IsString() @MaxLength(300) cookingNote?: string;
}

export class CancelOrderDto {
  @IsNumber() userId!: number;
}

/** Admin attaches / clears the "food being made" clip on a specific order. */
export class SetPrepVideoDto {
  @IsOptional() @IsString() @MaxLength(2048) prepVideoUrl?: string | null;
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
  /* C1: rider identity. A non-admin status change must carry the id of the
     rider assigned to this order — strangers don't know it, so they can't
     drive or cancel other people's orders. @Type coerces the value the rider
     app sends (a string from localStorage) into a number before validation. */
  @IsOptional() @Type(() => Number) @IsNumber() deliveryPartnerId?: number;
  /* delivered handoff proof (§4.5 / §3.4) */
  @IsOptional() @IsString() @MaxLength(4) otp?: string;
  @IsOptional() @Type(() => Number) @IsNumber() riderLat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() riderLng?: number;
}

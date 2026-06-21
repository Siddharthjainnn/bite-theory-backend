import { IsNumber, IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateOrderItemDto {
  @IsNumber() orderId!: number;
  @IsNumber() productId!: number;
  @IsString() @IsNotEmpty() productName!: string;
  @IsNumber() unitPrice!: number;
  @IsNumber() quantity!: number;
  @IsNumber() lineTotal!: number;
}

export class UpdateOrderItemDto {
  @IsOptional() @IsNumber() orderId?: number;
  @IsOptional() @IsNumber() productId?: number;
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsNumber() unitPrice?: number;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsNumber() lineTotal?: number;
}
import { IsOptional, IsNumber, IsString } from 'class-validator';

export class CreateLoyaltyPointDto {
  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsOptional()
  @IsNumber()
  points?: number;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsNumber()
  orderId?: number;

}

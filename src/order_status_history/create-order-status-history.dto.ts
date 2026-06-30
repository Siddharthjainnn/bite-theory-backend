import { IsOptional, IsNumber, IsString } from 'class-validator';

export class CreateOrderStatusHistoryDto {
  @IsOptional()
  @IsNumber()
  orderId?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  note?: string;

}

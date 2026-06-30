import { IsOptional, IsNumber, IsString } from 'class-validator';

export class CreatePaymentDto {
  @IsOptional()
  @IsNumber()
  orderId?: number;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  transactionId?: string;

}

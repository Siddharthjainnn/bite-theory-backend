import { IsOptional, IsNumber, IsString } from 'class-validator';

export class CreateSupportTicketDto {
  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsOptional()
  @IsNumber()
  orderId?: number;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  status?: string;

    @IsOptional()
  @IsString()
  attachment?: string;



}

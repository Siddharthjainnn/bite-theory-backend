import { IsOptional, IsNumber, IsString } from 'class-validator';

export class CreateInventoryDto {
  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  lowThreshold?: number;

  @IsOptional()
  @IsString()
  stockStatus?: string;

}

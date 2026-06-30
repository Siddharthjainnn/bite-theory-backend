import { IsOptional, IsNumber } from 'class-validator';

export class CreateFavoriteDto {
  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsOptional()
  @IsNumber()
  productId?: number;

}

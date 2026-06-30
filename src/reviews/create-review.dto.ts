import { IsOptional, IsNumber, IsString } from 'class-validator';

export class CreateReviewDto {
  @IsOptional()
  @IsNumber()
  userId?: number;

  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsNumber()
  orderId?: number;

  @IsOptional()
  @IsNumber()
  rating?: number;

  @IsOptional()
  @IsString()
  comment?: string;


   @IsOptional()
  @IsString()
  image1?: string;

    @IsOptional()
  @IsString()
  image2?: string;

  
   @IsOptional()
  @IsString()
  image3?: string;

}

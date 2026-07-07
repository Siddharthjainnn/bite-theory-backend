import {
  IsString, IsNotEmpty, IsNumber, IsOptional,
  IsIn, Min, IsUrl, ValidateIf, IsBoolean } from 'class-validator';

export class CreateProductDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsNumber()
  categoryId: number;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  image?: string;

  @IsOptional() @IsString()
  videoUrl?: string;

  @IsNumber() @Min(0)
  price: number;

  @IsOptional() @IsNumber() @Min(0)
  offerPrice?: number;

  @IsOptional() @IsNumber() @Min(0)
  calories?: number;

  @IsOptional() @IsNumber() @Min(0)
  protein?: number;

  @IsOptional() @IsNumber() @Min(0)
  carbs?: number;

  @IsOptional() @IsNumber() @Min(0)
  fat?: number;

  @IsOptional() @IsIn(['active', 'inactive'])
  status?: string;

  @IsOptional() @IsBoolean() isTodaysSpecial?: boolean;
  @IsOptional() @IsBoolean() isVeg?: boolean;
  @IsOptional() @IsString() specialTag?: string;
}

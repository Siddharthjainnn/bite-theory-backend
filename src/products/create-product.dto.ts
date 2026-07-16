import {
  IsString, IsNotEmpty, IsNumber, IsOptional,
  IsIn, Min, IsUrl, ValidateIf, IsBoolean, Max } from 'class-validator';

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

  /* Suggestion #7 — nutrition had a floor (>= 0) but NO ceiling, so a typo
     could save a dish with 99999 calories and it would render on the product
     page as fact. These caps are generous for a single serving but reject
     obvious data-entry mistakes. */
  @IsOptional() @IsNumber() @Min(0) @Max(5000)
  calories?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(500)
  protein?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(1000)
  carbs?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(500)
  fat?: number;

  @IsOptional() @IsIn(['active', 'inactive'])
  status?: string;

  @IsOptional() @IsBoolean() isTodaysSpecial?: boolean;
  @IsOptional() @IsBoolean() isVeg?: boolean;
  @IsOptional() @IsString() specialTag?: string;
  @IsOptional() @IsBoolean() isSpinWheel?: boolean;
}

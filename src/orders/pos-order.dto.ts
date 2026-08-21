import {
  IsArray, IsInt, IsString, IsOptional, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PosItemDto {
  @IsInt()
  productId!: number;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class PosOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosItemDto)
  items!: PosItemDto[];

  @IsString()
  mobile!: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  cookingNote?: string;
}

import {
  IsString, IsNumber, IsOptional, IsBoolean, IsInt, IsArray, Min,
} from 'class-validator';

export class CreateThaliTemplateDto {
  @IsString() name: string;
  @IsNumber() @Min(0) basePrice: number;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsString() status?: string;
}

export class CreateThaliSectionDto {
  @IsInt() templateId: number;
  @IsString() name: string;
  @IsOptional() @IsInt() @Min(0) minSelect?: number;
  @IsOptional() @IsInt() @Min(1) maxSelect?: number;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class CreateThaliOptionDto {
  @IsInt() sectionId: number;
  @IsString() name: string;
  @IsOptional() @IsNumber() @Min(0) extraPrice?: number;
  @IsOptional() @IsInt() calories?: number;
  @IsOptional() @IsNumber() protein?: number;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsInt() @Min(1) maxQty?: number;
}

export class PriceCheckDto {
  /** portion-based selections; validated in detail by the service */
  @IsArray() selections: { optionId: number; qty: number }[];
}

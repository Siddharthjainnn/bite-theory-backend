import {
  IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber,
  IsOptional, IsString, Length, Min,
} from 'class-validator';

export class CreateOfferDto {
  @IsString() @IsNotEmpty() @Length(2, 120)
  title!: string;

  @IsOptional() @IsString() @Length(0, 200)
  subtitle?: string;

  @IsIn(['flat', 'percentage', 'free_item', 'free_delivery'])
  offerType!: string;

  @IsOptional() @IsNumber() @Min(0)
  rewardValue?: number;

  @IsOptional() @IsNumber() @Min(0)
  maxDiscount?: number;

  @IsOptional() @IsInt()
  freeProductId?: number;

  @IsOptional() @IsNumber() @Min(0)
  minOrder?: number;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional() @IsInt() @Min(1)
  usageLimit?: number;

  @IsOptional() @IsInt() @Min(0)
  perUserLimit?: number;

  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() @Length(0, 30) badge?: string;
  @IsOptional() @IsString() @Length(0, 9) accent?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateOfferDto extends CreateOfferDto {
  @IsOptional() @IsString() @IsNotEmpty() declare title: string;
  @IsOptional() @IsIn(['flat', 'percentage', 'free_item', 'free_delivery']) declare offerType: string;
  @IsOptional() @IsDateString() declare startsAt: string;
  @IsOptional() @IsDateString() declare endsAt: string;
}

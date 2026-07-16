import {
  IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Length, Min,
} from 'class-validator';

export class CreateFaqCategoryDto {
  @IsString() @IsNotEmpty() @Length(2, 80)
  name!: string;

  @IsOptional() @IsString() @Length(2, 80)
  slug?: string;

  @IsOptional() @IsString() @Length(0, 16)
  icon?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateFaqCategoryDto extends CreateFaqCategoryDto {
  @IsOptional() @IsString() @IsNotEmpty() @Length(2, 80)
  declare name: string;
}

export class CreateFaqArticleDto {
  @IsInt()
  categoryId!: number;

  @IsString() @IsNotEmpty() @Length(4, 300)
  question!: string;

  @IsString() @IsNotEmpty()
  answer!: string;

  @IsOptional() @IsString() @Length(0, 60)
  actionLabel?: string;

  @IsOptional() @IsString() @Length(0, 200)
  actionUrl?: string;

  @IsOptional() @IsString()
  keywords?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateFaqArticleDto extends CreateFaqArticleDto {
  @IsOptional() @IsInt()
  declare categoryId: number;

  @IsOptional() @IsString() @IsNotEmpty()
  declare question: string;

  @IsOptional() @IsString() @IsNotEmpty()
  declare answer: string;
}

export class FaqFeedbackDto {
  @IsBoolean()
  helpful!: boolean;

  @IsOptional() @IsString() @Length(0, 500)
  comment?: string;
}

import {
  IsString, IsOptional, IsEmail, IsInt, IsArray, IsBoolean,
  ValidateNested, MaxLength, Matches, IsIn, IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TiffinDayDto {
  @IsIn(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  day: string;

  @IsBoolean()
  enabled: boolean;

  @IsOptional() @IsString() @MaxLength(400)
  address?: string;

  @IsOptional() @IsString() @MaxLength(160)
  landmark?: string;

  @IsOptional() @IsString() @MaxLength(40)
  slot?: string;

  /* Present only when the address came from a Google Places pick. */
  @IsOptional() @IsNumber()
  lat?: number;

  @IsOptional() @IsNumber()
  lng?: number;

  @IsOptional() @IsString() @MaxLength(200)
  placeId?: string;
}

export class CreateTiffinLeadDto {
  @IsString() @MaxLength(120)
  name: string;

  /** Indian mobile: 10 digits starting 6-9. Rejects the 9-digit typos early. */
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Enter a valid 10-digit Indian mobile number.',
  })
  phone: string;

  @IsOptional() @IsEmail({}, { message: 'Enter a valid email address.' })
  email?: string;

  @IsOptional() @IsString() @MaxLength(80)
  area?: string;

  @IsOptional() @IsString() @MaxLength(60)
  planKey?: string;

  @IsOptional() @IsString() @MaxLength(120)
  planLabel?: string;

  @IsOptional() @IsInt()
  planPrice?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TiffinDayDto)
  schedule?: TiffinDayDto[];

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @IsOptional() @IsString() @MaxLength(80)
  source?: string;
}

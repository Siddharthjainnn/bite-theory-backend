import {
  IsOptional,
  IsString,
  IsBoolean,
  IsNotEmpty,
  Length,
  Matches,
} from 'class-validator';

/**
 * Fixes bugs #28, #29, #30.
 *
 * #30 — name / mobile / vehicleNo are now REQUIRED (were all @IsOptional()).
 * #28 — mobile must be a valid 10-digit Indian mobile (starts 6-9). No more
 *       unlimited-length numbers.
 * #29 — vehicleNo must match the standard Indian plate format, e.g.
 *       "MP09AB1234" (whitespace/dashes are stripped in the service before save;
 *       see delivery_partners.service.ts note below).
 */
export class CreateDeliveryPartnerDto {
  @IsString()
  @IsNotEmpty({ message: 'Partner name is required' })
  @Length(2, 60, { message: 'Name must be 2–60 characters' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Mobile number is required' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile must be a valid 10-digit Indian number (starts with 6–9)',
  })
  mobile!: string;

  @IsString()
  @IsNotEmpty({ message: 'Vehicle number is required' })
  @Matches(/^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}$/i, {
    message: 'Vehicle number must look like "MP09AB1234"',
  })
  vehicleNo!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @IsOptional()
  @IsString()
  photo?: string;

  @IsOptional()
  @IsString()
  id_proof?: string;
}

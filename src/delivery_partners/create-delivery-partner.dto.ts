import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class CreateDeliveryPartnerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  vehicleNo?: string;

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

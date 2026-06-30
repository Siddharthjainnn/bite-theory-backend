import { IsOptional, IsString, IsNumber } from 'class-validator';

export class CreateUserDto {
  @IsOptional()
  @IsString()
  googleId?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  profileImage?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  walletBalance?: number;

  @IsOptional()
  @IsNumber()
  loyaltyPoints?: number;

  @IsOptional()
  @IsString()
  loyaltyLevel?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsOptional()
  @IsNumber()
  referredBy?: number;

}

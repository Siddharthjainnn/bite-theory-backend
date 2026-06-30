import { IsOptional, IsNumber, IsString, IsBoolean } from 'class-validator';

export class CreateReferralDto {
  @IsOptional()
  @IsNumber()
  referrerId?: number;

  @IsOptional()
  @IsNumber()
  referredUserId?: number;

  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsOptional()
  @IsNumber()
  rewardAmount?: number;

  @IsOptional()
  @IsBoolean()
  isConverted?: boolean;

  @IsOptional()
  @IsBoolean()
  rewarded?: boolean;

}

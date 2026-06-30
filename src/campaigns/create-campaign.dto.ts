import { IsOptional, IsString, IsDateString, IsBoolean } from 'class-validator';

export class CreateCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: Date;

  @IsOptional()
  @IsBoolean()
  isSent?: boolean;

}

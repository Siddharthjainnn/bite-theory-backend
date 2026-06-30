import { IsOptional, IsNumber, IsString, IsObject } from 'class-validator';

export class CreateAuditLogDto {
  @IsOptional()
  @IsNumber()
  adminUserId?: number;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  entity?: string;

  @IsOptional()
  @IsNumber()
  entityId?: number;

  @IsOptional()
  @IsObject()
  details?: any;

}

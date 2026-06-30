import { IsOptional, IsString } from 'class-validator';

export class CreatePermissionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

}

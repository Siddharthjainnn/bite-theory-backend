import { IsOptional, IsNumber, IsString, IsBoolean } from 'class-validator';

export class CreateAdminUserDto {
  @IsOptional()
  @IsNumber()
  roleId?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  passwordHash?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

    @IsOptional()
  @IsString()
  avatar?: string;

}

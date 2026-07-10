import { IsOptional, IsNumber, IsString, IsBoolean, MinLength } from 'class-validator';

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

  /* Bug #32: the admin form sends a plain password; the service now hashes it.
     (Previously only passwordHash was accepted, so panel-created admins were
     saved with an unusable/plaintext password and couldn't log in.) */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

    @IsOptional()
  @IsString()
  avatar?: string;

}

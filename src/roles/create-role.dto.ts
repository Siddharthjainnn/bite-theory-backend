import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Sidebar section keys this role may open. Omit/null = use built-in defaults. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sections?: string[];

}

import { IsOptional, IsString, IsIn, MaxLength } from 'class-validator';

/** Admin-only: move a lead through the callback pipeline. */
export class UpdateTiffinLeadDto {
  @IsOptional() @IsIn(['new', 'contacted', 'converted', 'rejected'])
  status?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  adminNote?: string;
}

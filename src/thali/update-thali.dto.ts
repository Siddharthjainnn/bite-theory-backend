import { PartialType } from '@nestjs/mapped-types';
import {
  CreateThaliTemplateDto,
  CreateThaliSectionDto,
  CreateThaliOptionDto,
} from './create-thali.dto';

export class UpdateThaliTemplateDto extends PartialType(CreateThaliTemplateDto) {}
export class UpdateThaliSectionDto extends PartialType(CreateThaliSectionDto) {}
export class UpdateThaliOptionDto extends PartialType(CreateThaliOptionDto) {}

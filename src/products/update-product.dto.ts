import { PartialType } from '@nestjs/mapped-types';
import { CreateProductDto } from './create-product.dto';

// makes every field optional for PATCH/edit
export class UpdateProductDto extends PartialType(CreateProductDto) {}
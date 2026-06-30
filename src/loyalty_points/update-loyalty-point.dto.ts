import { PartialType } from '@nestjs/mapped-types';
import { CreateLoyaltyPointDto } from './create-loyalty-point.dto';

export class UpdateLoyaltyPointDto extends PartialType(CreateLoyaltyPointDto) {}

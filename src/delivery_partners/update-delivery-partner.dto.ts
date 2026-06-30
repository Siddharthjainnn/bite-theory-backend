import { PartialType } from '@nestjs/mapped-types';
import { CreateDeliveryPartnerDto } from './create-delivery-partner.dto';

export class UpdateDeliveryPartnerDto extends PartialType(CreateDeliveryPartnerDto) {}

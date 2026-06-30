import { PartialType } from '@nestjs/mapped-types';
import { CreateOrderStatusHistoryDto } from './create-order-status-history.dto';

export class UpdateOrderStatusHistoryDto extends PartialType(CreateOrderStatusHistoryDto) {}

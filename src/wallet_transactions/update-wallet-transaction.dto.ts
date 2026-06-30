import { PartialType } from '@nestjs/mapped-types';
import { CreateWalletTransactionDto } from './create-wallet-transaction.dto';

export class UpdateWalletTransactionDto extends PartialType(CreateWalletTransactionDto) {}

import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
} from '@nestjs/common';
import { WalletTransactionService } from './wallet_transactions.service';
import { CreateWalletTransactionDto } from './create-wallet-transaction.dto';
import { UpdateWalletTransactionDto } from './update-wallet-transaction.dto';

@Controller('wallet-transactions')
export class WalletTransactionController {
  constructor(private readonly service: WalletTransactionService) {}

  /** GET /wallet-transactions?userId=12 → that user's ledger, newest first */
  @Get()
  findAll(@Query('userId') userId?: string) {
    return this.service.findAll(userId ? Number(userId) : undefined);
  }

  /** GET /wallet-transactions/summary?userId=12 → { balance, totalCredited, totalDebited } */
  @Get('summary')
  summary(@Query('userId', ParseIntPipe) userId: number) {
    return this.service.summary(userId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateWalletTransactionDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWalletTransactionDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

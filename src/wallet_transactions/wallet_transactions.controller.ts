import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe, Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { WalletTransactionService } from './wallet_transactions.service';
import { CreateWalletTransactionDto } from './create-wallet-transaction.dto';
import { UpdateWalletTransactionDto } from './update-wallet-transaction.dto';
import { isAdminReq, requireAdmin, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — wallet ledgers are financial data.
 *
 *   GET /wallet-transactions?userId=X        → self or admin (userId required unless admin)
 *   GET /wallet-transactions/summary?userId= → self or admin
 *   GET /wallet-transactions/:id             → admin
 *   POST/PATCH/DELETE                        → admin (already key-gated by AdminWriteGuard)
 */
@Controller('wallet-transactions')
export class WalletTransactionController {
  constructor(private readonly service: WalletTransactionService) {}

  @Get()
  findAll(@Req() req: Request, @Query('userId') userId?: string) {
    if (isAdminReq(req)) {
      return this.service.findAll(userId ? Number(userId) : undefined);
    }
    if (!userId) {
      throw new UnauthorizedException('Admin key required to list all wallet transactions.');
    }
    requireSelfOrAdmin(req, Number(userId));
    return this.service.findAll(Number(userId));
  }

  @Get('summary')
  summary(@Req() req: Request, @Query('userId', ParseIntPipe) userId: number) {
    requireSelfOrAdmin(req, userId);
    return this.service.summary(userId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateWalletTransactionDto, @Req() req: Request) {
    requireAdmin(req);
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWalletTransactionDto,
    @Req() req: Request,
  ) {
    requireAdmin(req);
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.remove(id);
  }
}

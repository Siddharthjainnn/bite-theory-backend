import {
  Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AdminAuthGuard, AdminJwtPayload, verifyAdminJwt } from '../common/admin-auth.guard';
import { PosActor, PosService } from './pos.service';
import {
  CancelPosBillDto, CopyOutletPricesDto, CreatePosBillDto, OutletDto, SaveOutletPricesDto,
} from './pos.dto';

type AdminReq = Request & { admin?: AdminJwtPayload };

/** The logged-in admin, from their own JWT. The panel also sends the shared
 *  key (which AdminAuthGuard treats as "super admin"), so the JWT is read
 *  first — that's what puts the cashier's real name on the bill. */
function loginOf(req: AdminReq): AdminJwtPayload | null {
  const bearer = ((req.headers['authorization'] as string) || '').replace(/^Bearer\s+/i, '').trim();
  const fromJwt = bearer ? verifyAdminJwt(bearer) : null;
  if (fromJwt) return fromJwt;
  return req.admin && req.admin.sub ? req.admin : null;
}

function actorOf(req: AdminReq): PosActor {
  const a = loginOf(req);
  if (!a) return { id: null, name: 'Admin' };
  return { id: Number(a.sub) || null, name: a.name || a.email || `admin#${a.sub}` };
}

const optId = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : null);

/**
 * /api/pos — the counter till. Role section: "pos" (Cashier role).
 *   GET  pos/outlets                    outlets this till can bill for
 *   GET  pos/outlets/:id/menu           dishes on sale here, at this outlet's rates
 *   POST pos/bills                      save a bill (token + bill number issued here)
 *   GET  pos/bills?outletId&date&q      one business day's bills, for reprint
 *   GET  pos/bills/:id                  one bill
 *   POST pos/bills/:id/printed          count a print (reprints say DUPLICATE)
 *
 * /api/pos/manage — section "outlets" (managers): cancel a bill
 * /api/pos/reports — section "pos_reports": sales summary + CSV exports
 * /api/outlets — section "outlets": outlets and their rate lists
 */
@UseGuards(AdminAuthGuard)
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('outlets')
  outlets() {
    return this.pos.listOutlets(false);
  }

  @Get('outlets/:id/menu')
  menu(@Param('id', ParseIntPipe) id: number) {
    return this.pos.menu(id);
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('bills')
  create(@Body() dto: CreatePosBillDto, @Req() req: AdminReq) {
    return this.pos.createBill(dto, actorOf(req));
  }

  @Get('bills')
  list(@Query('outletId', ParseIntPipe) outletId: number, @Query('date') date?: string, @Query('q') q?: string) {
    return this.pos.listBills(outletId, date, q);
  }

  @Get('bills/:id')
  one(@Param('id', ParseIntPipe) id: number) {
    return this.pos.getBill(id);
  }

  @Post('bills/:id/printed')
  printed(@Param('id', ParseIntPipe) id: number) {
    return this.pos.markPrinted(id);
  }

  @Post('manage/bills/:id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelPosBillDto, @Req() req: AdminReq) {
    const login = loginOf(req);
    await this.pos.assertCanCancel(login ? String(login.role || '').toLowerCase() || 'unknown' : null);
    return this.pos.cancelBill(id, dto.reason, actorOf(req), req);
  }

  @Get('reports/summary')
  summary(@Query('from') from?: string, @Query('to') to?: string, @Query('outletId') outletId?: string) {
    return this.pos.summary(from, to, optId(outletId));
  }

  @Get('reports/bills.csv')
  async billsCsv(@Res() res: Response, @Query('from') from?: string, @Query('to') to?: string, @Query('outletId') outletId?: string) {
    const csv = await this.pos.billsCsv(from, to, optId(outletId));
    res.status(200).type('text/csv')
      .setHeader('Content-Disposition', `attachment; filename="counter-bills-${from || 'today'}-to-${to || from || 'today'}.csv"`)
      .send('﻿' + csv); // BOM so Excel reads ₹ and Hindi names correctly
  }

  @Get('reports/items.csv')
  async itemsCsv(@Res() res: Response, @Query('from') from?: string, @Query('to') to?: string, @Query('outletId') outletId?: string) {
    const csv = await this.pos.itemsCsv(from, to, optId(outletId));
    res.status(200).type('text/csv')
      .setHeader('Content-Disposition', `attachment; filename="counter-items-${from || 'today'}-to-${to || from || 'today'}.csv"`)
      .send('﻿' + csv);
  }
}

@UseGuards(AdminAuthGuard)
@Controller('outlets')
export class OutletsController {
  constructor(private readonly pos: PosService) {}

  @Get()
  all() {
    return this.pos.listOutlets(true);
  }

  @Post()
  create(@Body() dto: OutletDto, @Req() req: Request) {
    return this.pos.saveOutlet(null, dto, req);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: OutletDto, @Req() req: Request) {
    return this.pos.saveOutlet(id, dto, req);
  }

  @Get(':id/prices')
  prices(@Param('id', ParseIntPipe) id: number) {
    return this.pos.outletPrices(id);
  }

  @Put(':id/prices')
  savePrices(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveOutletPricesDto, @Req() req: Request) {
    return this.pos.saveOutletPrices(id, dto, req);
  }

  @Post(':id/prices/copy')
  copy(@Param('id', ParseIntPipe) id: number, @Body() dto: CopyOutletPricesDto, @Req() req: Request) {
    return this.pos.copyOutletPrices(id, dto, req);
  }
}

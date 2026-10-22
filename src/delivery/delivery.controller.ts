import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { RiderAuthGuard } from '../common/rider-auth.guard';
import { TripsService } from './trips.service';
import { DispatchService } from './dispatch.service';
import { DeliveryReportService } from './delivery-report.service';
import { EtaService } from './eta.service';

type RiderReq = Request & { riderId?: number };

const ids = (v: unknown): number[] =>
  Array.isArray(v)
    ? v
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 3)
    : [];

/**
 * /api/delivery — trips, riders, dispatch suggestions, the delivery report.
 * Admin routes: AdminAuthGuard (admin JWT or the master key).
 * Rider routes: RiderAuthGuard; the rider id always comes from the token.
 */
@Controller('delivery')
export class DeliveryController {
  constructor(
    private readonly trips: TripsService,
    private readonly dispatch: DispatchService,
    private readonly report: DeliveryReportService,
    private readonly eta: EtaService,
  ) {}

  /* ── admin ── */

  @UseGuards(AdminAuthGuard)
  @Get('riders')
  riders() {
    return this.trips.riders();
  }

  @UseGuards(AdminAuthGuard)
  @Get('suggestions')
  suggestions() {
    return this.dispatch.suggestions();
  }

  @UseGuards(AdminAuthGuard)
  @Get('trips')
  openTrips() {
    return this.trips.openTrips();
  }

  @UseGuards(AdminAuthGuard)
  @Post('trips')
  createTrip(
    @Body()
    body: {
      orderIds?: unknown;
      riderId?: unknown;
      force?: unknown;
      source?: unknown;
    },
  ) {
    const riderId = Number(body?.riderId);
    if (!Number.isInteger(riderId) || riderId <= 0)
      throw new BadRequestException('Pick a rider.');
    return this.trips.createTrip({
      orderIds: ids(body?.orderIds),
      riderId,
      force: body?.force === true,
      source: body?.source === 'suggested' ? 'suggested' : 'admin',
    });
  }

  @UseGuards(AdminAuthGuard)
  @Post('trips/:id/orders')
  addToTrip(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { orderId?: unknown; force?: unknown },
  ) {
    const orderId = Number(body?.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0)
      throw new BadRequestException('Pick an order.');
    return this.trips.addToTrip(id, orderId, body?.force === true);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('trips/:id/stops')
  reorder(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { orderIds?: unknown },
  ) {
    return this.trips.reorder(id, ids(body?.orderIds));
  }

  @UseGuards(AdminAuthGuard)
  @Get('report')
  deliveryReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.report.report(from, to);
  }

  @UseGuards(AdminAuthGuard)
  @Post('eta/recompute')
  recompute() {
    return this.eta.recompute();
  }

  /** Run the dispatch loop now (delay alerts, auto-dispatch, model refresh) instead of waiting ≤30 s. */
  @UseGuards(AdminAuthGuard)
  @Post('tick')
  async tick() {
    await this.dispatch.tick();
    return { ok: true };
  }

  /* ── rider ── */

  @UseGuards(RiderAuthGuard)
  @Get('riders/me/trip')
  myTrip(@Req() req: RiderReq) {
    return this.trips.riderTrip(Number(req.riderId));
  }

  @UseGuards(RiderAuthGuard)
  @Patch('riders/me/shift')
  shift(@Req() req: RiderReq, @Body() body: { status?: unknown }) {
    if (body?.status !== 'online' && body?.status !== 'offline') {
      throw new BadRequestException('status must be online or offline');
    }
    return this.trips.setShift(Number(req.riderId), body.status);
  }

  @UseGuards(RiderAuthGuard)
  @Patch('trips/:id/pickup')
  pickup(@Param('id', ParseIntPipe) id: number, @Req() req: RiderReq) {
    return this.trips.pickup(id, Number(req.riderId));
  }
}

import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { authUidFromReq } from '../common/req-auth.util';
import { StorefrontService } from './storefront.service';

/**
 * /api/storefront
 *   POST launch/notify             PUBLIC: "Notify me on opening day" (5/min per IP, unique by phone)
 *   GET  launch/subscribers        admin: count + latest (phones masked)
 *   GET  launch/subscribers.csv    admin: full list for export
 *   GET  outlets                   PUBLIC: takeaway outlets for checkout
 * The banner text, opening time, price comparison and app tiles are
 * store settings (storefrontConfig) — read with GET /settings, saved with PATCH /settings.
 */
@Controller('storefront')
export class StorefrontController {
  constructor(private readonly service: StorefrontService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('launch/notify')
  notify(
    @Body() body: { phone?: unknown; name?: unknown },
    @Req() req: Request,
  ) {
    return this.service.subscribe(body, authUidFromReq(req));
  }

  @Get('outlets')
  outlets() {
    return this.service.outlets();
  }

  @UseGuards(AdminAuthGuard)
  @Get('launch/subscribers')
  subscribers() {
    return this.service.stats();
  }

  @UseGuards(AdminAuthGuard)
  @Get('launch/subscribers.csv')
  async csv(@Res() res: Response) {
    res
      .status(200)
      .type('text/csv')
      .setHeader(
        'Content-Disposition',
        'attachment; filename="opening-day-list.csv"',
      );
    res.send(await this.service.csv());
  }
}

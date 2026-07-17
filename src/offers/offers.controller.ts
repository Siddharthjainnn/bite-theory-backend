import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { OffersService } from './offers.service';
import { CreateOfferDto, UpdateOfferDto } from './dto';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { verifyUserToken } from '../common/user-auth.guard';

@Controller('offers')
export class OffersController {
  constructor(private readonly service: OffersService) {}

  /* ── public ── */

  /**
   * Live offers for the storefront. Signed-in customers also get `usedByYou`
   * so the UI can grey out what they've already claimed rather than letting
   * them tap something that will be refused at checkout.
   */
  @Get()
  live(@Req() req: Request) {
    const uid = verifyUserToken((req.headers['x-user-token'] as string) || '');
    return this.service.live(uid ?? undefined);
  }

  /** Check an offer against a cart before applying it. */
  @Get(':id/check')
  check(
    @Param('id', ParseIntPipe) id: number,
    @Query('subtotal') subtotal: string,
    @Query('deliveryCharge') deliveryCharge: string,
    @Req() req: Request,
  ) {
    const uid = verifyUserToken((req.headers['x-user-token'] as string) || '');
    if (!uid) return { valid: false, discount: 0, message: 'Please sign in to use this offer.' };
    return this.service.check(id, uid, Number(subtotal || 0), Number(deliveryCharge || 0));
  }

  /* ── admin ── */

  @UseGuards(AdminAuthGuard)
  @Get('admin/all')
  adminList() { return this.service.adminList(); }

  @UseGuards(AdminAuthGuard)
  @Post()
  create(@Body() dto: CreateOfferDto, @Req() req: Request) {
    return this.service.create(dto, req);
  }

  @UseGuards(AdminAuthGuard)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOfferDto, @Req() req: Request) {
    return this.service.update(id, dto, req);
  }

  @UseGuards(AdminAuthGuard)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.service.remove(id, req);
  }
}

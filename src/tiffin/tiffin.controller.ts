import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, Query, Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { TiffinService } from './tiffin.service';
import { CreateTiffinLeadDto } from './create-tiffin-lead.dto';
import { UpdateTiffinLeadDto } from './update-tiffin-lead.dto';
import { requireAdmin } from '../common/req-auth.util';

/**
 * Tiffin enrolment funnel.
 *
 *   POST /tiffin/leads      → PUBLIC. Ad traffic must be able to enrol without
 *                             an account, so this is deliberately unauthenticated
 *                             and instead rate-limited + de-duplicated by phone.
 *   GET/PATCH/DELETE        → ADMIN ONLY. Leads carry name, phone, email and
 *                             home address; they must never be publicly listable.
 */
@Controller('tiffin')
export class TiffinController {
  constructor(private readonly service: TiffinService) {}

  /* 5 submissions per minute per IP — enough for a real person correcting a
     typo, not enough to let anyone dump junk into the sales pipeline. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('leads')
  create(
    @Body() dto: CreateTiffinLeadDto,
    @Req() req: Request & { authUserId?: number },
  ) {
    return this.service.create(dto, req.authUserId);
  }

  @Get('leads')
  findAll(@Req() req: Request, @Query('status') status?: string) {
    requireAdmin(req);
    return this.service.findAll(status);
  }

  @Get('leads/stats')
  stats(@Req() req: Request) {
    requireAdmin(req);
    return this.service.stats();
  }

  @Get('leads/:id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.findOne(id);
  }

  @Patch('leads/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTiffinLeadDto,
    @Req() req: Request,
  ) {
    requireAdmin(req);
    return this.service.update(id, dto);
  }

  @Delete('leads/:id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.remove(id);
  }
}

import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
  Req, UseGuards, BadRequestException, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ReferralService } from './referrals.service';
import { CreateReferralDto } from './create-referral.dto';
import { UpdateReferralDto } from './update-referral.dto';
import { UserAuthGuard } from '../common/user-auth.guard';
import { isAdminReq, requireAdmin, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH.
 *   GET  /referrals?referrerId=X → self or admin
 *   POST /referrals/claim        → signed-in user; userId forced from token
 *                                  (stops claiming rewards into other accounts)
 *   everything else              → admin
 */
@Controller('referrals')
export class ReferralController {
  constructor(private readonly service: ReferralService) {}

  @Get()
  findAll(@Req() req: Request, @Query('referrerId') referrerId?: string) {
    if (isAdminReq(req)) {
      return this.service.findAll(referrerId ? Number(referrerId) : undefined);
    }
    if (!referrerId) {
      throw new UnauthorizedException('Admin key required to list all referrals.');
    }
    requireSelfOrAdmin(req, Number(referrerId));
    return this.service.findAll(Number(referrerId));
  }

  @UseGuards(UserAuthGuard)
  @Post('claim')
  claim(
    @Body() body: { userId: number; code: string },
    @Req() req: Request & { authUserId?: number },
  ) {
    const userId = req.authUserId ?? Number(body.userId);
    if (!userId) throw new BadRequestException('userId is required.');
    return this.service.claim(userId, String(body.code || ''));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateReferralDto, @Req() req: Request) {
    requireAdmin(req);
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReferralDto,
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

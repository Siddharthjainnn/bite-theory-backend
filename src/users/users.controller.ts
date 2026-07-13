import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { UserService } from './users.service';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';
import { requireAdmin, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — this controller is now ADMIN-ONLY except GET /:id (self).
 *
 * Why: PATCH /users/:id used to be in the public allow-list while UpdateUserDto
 * accepts walletBalance / loyaltyPoints / loyaltyLevel / status. Anyone could
 * set their own wallet to any amount and check out for free.
 *
 * Customer profile edits (name/mobile) never used this controller — they go
 * through the session-checked Next.js route (app/account/profile/route.ts) —
 * so locking this down breaks nothing on the storefront.
 *
 * The admin panel keeps working: it sends x-admin-key on every call.
 */
@Controller('users')
export class UserController {
  constructor(private readonly service: UserService) {}

  /** Full customer list = PII dump → admin only. */
  @Get()
  findAll(@Req() req: Request) {
    requireAdmin(req);
    return this.service.findAll();
  }

  /** A user may read their own row; admin may read anyone. */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireSelfOrAdmin(req, id);
    return this.service.findOne(id);
  }

  /** Admin only (also enforced by AdminWriteGuard now that the
      allow-list entry is removed — this is defense in depth). */
  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: Request) {
    requireAdmin(req);
    return this.service.create(dto);
  }

  /** Admin only. Wallet/points/status changes must come from the admin panel
      (and ideally, wallet should only ever move via wallet_transactions). */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
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

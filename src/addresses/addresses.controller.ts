import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
  Req, UseGuards, UnauthorizedException, BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { AddressService } from './addresses.service';
import { CreateAddressDto } from './create-address.dto';
import { UpdateAddressDto } from './update-address.dto';
import { UserAuthGuard } from '../common/user-auth.guard';
import { isAdminReq, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — addresses are home addresses; every route is now
 * ownership-checked.
 *
 * Before: GET /addresses (no filter) returned EVERY customer's address, and
 * POST/PATCH/DELETE were allow-listed with no check — anyone could edit or
 * delete anyone's address by id.
 *
 * Now:
 *   GET    /addresses?userId=X → self or admin (userId required unless admin)
 *   GET    /addresses/:id      → owner or admin
 *   POST   /addresses          → signed-in user; userId forced from token
 *   PATCH  /addresses/:id      → owner or admin; userId cannot be reassigned
 *   DELETE /addresses/:id      → owner or admin
 */
@Controller('addresses')
export class AddressController {
  constructor(private readonly service: AddressService) {}

  @Get()
  findAll(@Req() req: Request, @Query('userId') userId?: string) {
    if (isAdminReq(req)) {
      return this.service.findAll(userId ? Number(userId) : undefined);
    }
    if (!userId) {
      throw new UnauthorizedException('Admin key required to list all addresses.');
    }
    requireSelfOrAdmin(req, Number(userId));
    return this.service.findAll(Number(userId));
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const item = await this.service.findOne(id);
    requireSelfOrAdmin(req, (item as any).userId);
    return item;
  }

  @UseGuards(UserAuthGuard)
  @Post()
  create(
    @Body() dto: CreateAddressDto,
    @Req() req: Request & { authUserId?: number },
  ) {
    // When token enforcement is on, the owner is ALWAYS the token holder —
    // the client-supplied userId is ignored.
    if (req.authUserId) dto.userId = req.authUserId;
    if (!dto.userId) throw new BadRequestException('userId is required.');
    return this.service.create(dto);
  }

  @UseGuards(UserAuthGuard)
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAddressDto,
    @Req() req: Request & { authUserId?: number },
  ) {
    const existing = await this.service.findOne(id);
    requireSelfOrAdmin(req, (existing as any).userId);
    // an address can never be moved to another user via PATCH
    delete (dto as any).userId;
    return this.service.update(id, dto);
  }

  @UseGuards(UserAuthGuard)
  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { authUserId?: number },
  ) {
    const existing = await this.service.findOne(id);
    requireSelfOrAdmin(req, (existing as any).userId);
    return this.service.remove(id);
  }
}

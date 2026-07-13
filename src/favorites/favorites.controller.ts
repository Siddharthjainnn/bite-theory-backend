import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
  Req, UseGuards, BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { FavoriteService } from './favorites.service';
import { CreateFavoriteDto } from './create-favorite.dto';
import { UpdateFavoriteDto } from './update-favorite.dto';
import { UserAuthGuard } from '../common/user-auth.guard';
import { requireAdmin, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — favorites reveal user behavior; toggling as another
 * user was possible before.
 *   GET  /favorites?userId=X     → self or admin
 *   GET  /favorites/ids?userId=X → self or admin
 *   POST /favorites/toggle       → signed-in user; userId forced from token
 *   raw CRUD (:id)               → admin
 */
@Controller('favorites')
export class FavoriteController {
  constructor(private readonly service: FavoriteService) {}

  @Get()
  findAll(@Req() req: Request, @Query('userId') userId?: string) {
    if (!userId) { requireAdmin(req); return this.service.findAll(undefined); }
    requireSelfOrAdmin(req, Number(userId));
    return this.service.findAll(Number(userId));
  }

  @Get('ids')
  ids(@Req() req: Request, @Query('userId', ParseIntPipe) userId: number) {
    requireSelfOrAdmin(req, userId);
    return this.service.idsForUser(userId);
  }

  @UseGuards(UserAuthGuard)
  @Post('toggle')
  toggle(
    @Body() body: { userId: number; productId: number },
    @Req() req: Request & { authUserId?: number },
  ) {
    const userId = req.authUserId ?? Number(body.userId);
    if (!userId) throw new BadRequestException('userId is required.');
    return this.service.toggle(userId, Number(body.productId));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req);
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateFavoriteDto, @Req() req: Request) {
    requireAdmin(req);
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFavoriteDto,
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

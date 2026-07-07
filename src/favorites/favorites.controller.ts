import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
} from '@nestjs/common';
import { FavoriteService } from './favorites.service';
import { CreateFavoriteDto } from './create-favorite.dto';
import { UpdateFavoriteDto } from './update-favorite.dto';

@Controller('favorites')
export class FavoriteController {
  constructor(private readonly service: FavoriteService) {}

  /** GET /favorites?userId=12 → favorites joined with product info */
  @Get()
  findAll(@Query('userId') userId?: string) {
    return this.service.findAll(userId ? Number(userId) : undefined);
  }

  /** GET /favorites/ids?userId=12 → [3, 8, 21] for painting hearts */
  @Get('ids')
  ids(@Query('userId', ParseIntPipe) userId: number) {
    return this.service.idsForUser(userId);
  }

  /** POST /favorites/toggle { userId, productId } → { favorited: bool } */
  @Post('toggle')
  toggle(@Body() body: { userId: number; productId: number }) {
    return this.service.toggle(Number(body.userId), Number(body.productId));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateFavoriteDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFavoriteDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

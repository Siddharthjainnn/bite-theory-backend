import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe,
} from '@nestjs/common';
import { FavoriteService } from './favorites.service';
import { CreateFavoriteDto } from './create-favorite.dto';
import { UpdateFavoriteDto } from './update-favorite.dto';

@Controller('favorites')
export class FavoriteController {
  constructor(private readonly service: FavoriteService) {}

  @Get()
  findAll() {
    return this.service.findAll();
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

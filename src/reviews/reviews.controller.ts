import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
} from '@nestjs/common';
import { ReviewService } from './reviews.service';
import { CreateReviewDto } from './create-review.dto';
import { UpdateReviewDto } from './update-review.dto';

@Controller('reviews')
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  /** GET /reviews?userId=12 (my reviews) or /reviews?productId=5 (product reviews) */
  @Get()
  findAll(
    @Query('userId') userId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.service.findAll({
      userId: userId ? Number(userId) : undefined,
      productId: productId ? Number(productId) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateReviewDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReviewDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

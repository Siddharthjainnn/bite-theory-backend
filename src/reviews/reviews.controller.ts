import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, ParseIntPipe,
  Req, UseGuards, BadRequestException, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ReviewService } from './reviews.service';
import { CreateReviewDto } from './create-review.dto';
import { UpdateReviewDto } from './update-review.dto';
import { UserAuthGuard } from '../common/user-auth.guard';
import { isAdminReq, requireAdmin, requireSelfOrAdmin } from '../common/req-auth.util';

/**
 * P0 SECURITY PATCH — no more posting reviews as somebody else.
 *
 *   GET  /reviews?productId=X → public (product page ratings)
 *   GET  /reviews?userId=X    → self or admin ("My Reviews")
 *   GET  /reviews             → admin only (full dump)
 *   POST /reviews             → signed-in user; userId forced from token
 *   DELETE /reviews/:id       → owner or admin
 *   PATCH  /reviews/:id       → admin only
 */
@Controller('reviews')
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Get()
  findAll(
    @Req() req: Request,
    @Query('userId') userId?: string,
    @Query('productId') productId?: string,
  ) {
    if (productId) {
      return this.service.findAll({ productId: Number(productId) });
    }
    if (userId) {
      requireSelfOrAdmin(req, Number(userId));
      return this.service.findAll({ userId: Number(userId) });
    }
    if (!isAdminReq(req)) {
      throw new UnauthorizedException('Admin key required to list all reviews.');
    }
    return this.service.findAll({});
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    requireAdmin(req); // raw row (user_id, order_id) — admin panel only
    return this.service.findOne(id);
  }

  @UseGuards(UserAuthGuard)
  @Post()
  create(
    @Body() dto: CreateReviewDto,
    @Req() req: Request & { authUserId?: number },
  ) {
    if (req.authUserId) (dto as any).userId = req.authUserId;
    if (!(dto as any).userId) throw new BadRequestException('userId is required.');
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReviewDto,
    @Req() req: Request,
  ) {
    requireAdmin(req);
    return this.service.update(id, dto);
  }

  @UseGuards(UserAuthGuard)
  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request & { authUserId?: number },
  ) {
    const review = await this.service.findOne(id);
    requireSelfOrAdmin(req, (review as any).userId);
    return this.service.remove(id);
  }
}

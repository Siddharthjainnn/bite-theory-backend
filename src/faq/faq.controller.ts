import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FaqService } from './faq.service';
import {
  CreateFaqArticleDto, CreateFaqCategoryDto, FaqFeedbackDto,
  UpdateFaqArticleDto, UpdateFaqCategoryDto,
} from './dto';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { verifyUserToken } from '../common/user-auth.guard';

@Controller('faq')
export class FaqController {
  constructor(private readonly service: FaqService) {}

  /* ── public ── */

  /** Whole help centre (categories + articles), optionally filtered by ?q= */
  @Get()
  tree(@Query('q') q?: string) {
    return this.service.publicTree(q);
  }

  /** Fire-and-forget read counter (public, no auth — it's just a metric). */
  @Post(':id/view')
  view(@Param('id', ParseIntPipe) id: number) {
    return this.service.trackView(id);
  }

  /** "Was this helpful?" — works signed-out; signed-in votes are deduped. */
  @Post(':id/feedback')
  feedback(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FaqFeedbackDto,
    @Req() req: Request,
  ) {
    const uid = verifyUserToken((req.headers['x-user-token'] as string) || '');
    return this.service.feedback(id, uid ?? null, dto);
  }

  /* ── admin ── */

  @UseGuards(AdminAuthGuard)
  @Get('admin/all')
  adminList() {
    return this.service.adminList();
  }

  /** The answers customers keep marking unhelpful — i.e. what to rewrite. */
  @UseGuards(AdminAuthGuard)
  @Get('admin/problems')
  problems() {
    return this.service.problemArticles();
  }

  @UseGuards(AdminAuthGuard)
  @Post('categories')
  createCategory(@Body() dto: CreateFaqCategoryDto, @Req() req: Request) {
    return this.service.createCategory(dto, req);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('categories/:id')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFaqCategoryDto,
    @Req() req: Request,
  ) {
    return this.service.updateCategory(id, dto, req);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('categories/:id')
  removeCategory(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.service.removeCategory(id, req);
  }

  @UseGuards(AdminAuthGuard)
  @Post('articles')
  createArticle(@Body() dto: CreateFaqArticleDto, @Req() req: Request) {
    return this.service.createArticle(dto, req);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('articles/:id')
  updateArticle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFaqArticleDto,
    @Req() req: Request,
  ) {
    return this.service.updateArticle(id, dto, req);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('articles/:id')
  removeArticle(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.service.removeArticle(id, req);
  }
}

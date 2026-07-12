import { Controller, Get, Post, Body } from '@nestjs/common';
import { FlashService } from './flash.service';

@Controller('flash-deals')
export class FlashController {
  constructor(private readonly service: FlashService) {}

  @Get('current')
  current() { return this.service.current(); }

  /** admin-key writes (global AdminWriteGuard) */
  @Post('start')
  start(@Body() b: { title?: string; discountPct: number; minutes?: number }) {
    return this.service.startNow(b.title || '', Number(b.discountPct), Number(b.minutes || 120));
  }

  @Post('stop')
  stop() { return this.service.stop(); }
}

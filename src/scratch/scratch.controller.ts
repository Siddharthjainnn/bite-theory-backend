import { Controller, Get, Post, Param, Query, Body, ParseIntPipe } from '@nestjs/common';
import { ScratchService } from './scratch.service';

@Controller('scratch-cards')
export class ScratchController {
  constructor(private readonly service: ScratchService) {}

  @Get('order/:orderId')
  forOrder(@Param('orderId', ParseIntPipe) orderId: number, @Query('userId') userId: string) {
    return this.service.forOrder(orderId, Number(userId));
  }

  /** allow-listed customer write in AdminWriteGuard */
  @Post(':id/scratch')
  scratch(@Param('id', ParseIntPipe) id: number, @Body() body: { userId: number }) {
    return this.service.scratch(id, Number(body.userId));
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderStatusHistory } from './order-status-history.entity';
import { OrderStatusHistoryService } from './order_status_history.service';
import { OrderStatusHistoryController } from './order_status_history.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OrderStatusHistory])],
  controllers: [OrderStatusHistoryController],
  providers: [OrderStatusHistoryService],
})
export class OrderStatusHistoryModule {}

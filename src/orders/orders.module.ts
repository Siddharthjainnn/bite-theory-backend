import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './order.entity';
import { OrderStatusHistory } from './order-status-history.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderStatusHistory])],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './order.entity';
import { OrderStatusHistory } from './order-status-history.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { RazorpayService } from './razorpay.service';
import { MailService } from '../common/mail.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderStatusHistory])],
  controllers: [OrdersController],
  providers: [OrdersService, RazorpayService, MailService],
})
export class OrdersModule {}
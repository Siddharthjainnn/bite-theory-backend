import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportTicket } from './support-ticket.entity';
import { SupportTicketService } from './support_tickets.service';
import { SupportTicketController } from './support_tickets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SupportTicket])],
  controllers: [SupportTicketController],
  providers: [SupportTicketService],
})
export class SupportTicketModule {}

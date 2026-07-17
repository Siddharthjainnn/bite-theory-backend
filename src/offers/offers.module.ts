import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Offer } from './offer.entity';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { AuditLogModule } from '../audit_logs/audit_logs.module';

@Module({
  imports: [TypeOrmModule.forFeature([Offer]), AuditLogModule],
  controllers: [OffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryPartner } from './delivery-partner.entity';
import { DeliveryPartnerService } from './delivery_partners.service';
import { DeliveryPartnerController } from './delivery_partners.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DeliveryPartner])],
  controllers: [DeliveryPartnerController],
  providers: [DeliveryPartnerService],
  exports: [DeliveryPartnerService],
})
export class DeliveryPartnerModule {}

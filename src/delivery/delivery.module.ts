import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryPartnerModule } from '../delivery_partners/delivery_partners.module';
import { SettingsModule } from '../settings/settings.module';
import { MailService } from '../common/mail.service';
import { EtaModule } from './eta.module';
import { NotifyModule } from '../notify/notify.module';
import { TripsService } from './trips.service';
import { DispatchService } from './dispatch.service';
import { DeliveryReportService } from './delivery-report.service';
import { DeliveryController } from './delivery.controller';

/** Trips, riders, dispatch suggestions, background loop, delivery report. */
@Module({
  imports: [OrdersModule, DeliveryPartnerModule, SettingsModule, EtaModule, NotifyModule],
  controllers: [DeliveryController],
  providers: [
    TripsService,
    DispatchService,
    DeliveryReportService,
    MailService,
  ],
})
export class DeliveryModule {}

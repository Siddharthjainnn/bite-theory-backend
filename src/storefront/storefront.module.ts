import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { NotifyModule } from '../notify/notify.module';
import { StorefrontService } from './storefront.service';
import { StorefrontController } from './storefront.controller';

/** Home-page launch list + opening-day WhatsApp. */
@Module({
  imports: [SettingsModule, NotifyModule],
  controllers: [StorefrontController],
  providers: [StorefrontService],
})
export class StorefrontModule {}

import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { WhatsAppService } from './whatsapp.service';
import { OutboxService } from './outbox.service';
import { NotifyService } from './notify.service';
import { NotifyController } from './notify.controller';

/** WhatsApp notifications. Depends only on settings, so orders and delivery can both use it. */
@Module({
  imports: [SettingsModule],
  controllers: [NotifyController],
  providers: [WhatsAppService, OutboxService, NotifyService],
  exports: [NotifyService, OutboxService],
})
export class NotifyModule {}

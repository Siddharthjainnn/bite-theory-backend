import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { EtaService } from './eta.service';

/** The time model on its own, so OrdersModule can use it without a cycle. */
@Module({
  imports: [SettingsModule],
  providers: [EtaService],
  exports: [EtaService],
})
export class EtaModule {}

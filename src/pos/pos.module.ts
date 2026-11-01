import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AuditLogModule } from '../audit_logs/audit_logs.module';
import { PosService } from './pos.service';
import { OutletsController, PosController } from './pos.controller';

/** Walk-in counter billing: outlets, rate lists, tokens, bills, reports. */
@Module({
  imports: [SettingsModule, AuditLogModule],
  controllers: [PosController, OutletsController],
  providers: [PosService],
})
export class PosModule {}

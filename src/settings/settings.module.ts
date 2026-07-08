import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreSettings } from './settings.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StoreSettings])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService], // OrdersModule imports this for dynamic pricing + open-check
})
export class SettingsModule {}

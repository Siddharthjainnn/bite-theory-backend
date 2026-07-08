import { Controller, Get, Patch, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './update-settings.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  /** Public: storefront reads delivery charge, min/max, hours. */
  @Get()
  get() {
    return this.service.get();
  }

  /** Public: "are we open right now?" + friendly closed message. */
  @Get('status')
  status() {
    return this.service.status();
  }

  /** Admin-only: your global AdminWriteGuard already protects all
   *  non-GET requests, so this PATCH requires x-admin-key. */
  @Patch()
  update(@Body() dto: UpdateSettingsDto) {
    return this.service.update(dto);
  }
}

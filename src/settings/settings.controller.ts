import { Controller, Get, Patch, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { isAdminReq } from '../common/req-auth.util';
import { verifyAdminJwt } from '../common/admin-auth.guard';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './update-settings.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  /** Public: storefront reads delivery charge, min/max, hours. */
  @Get()
  async get(@Req() req: Request) {
    const s = await this.service.get();
    /* The storefront reads this endpoint publicly. Delivery rules (make-good
       amount, batch bonus, dispatch tuning) are for staff only. */
    const bearer = ((req.headers['authorization'] as string) || '').replace(/^Bearer\s+/i, '');
    if (isAdminReq(req) || verifyAdminJwt(bearer)) return s;
    const { dispatchConfig: _hidden, ...pub } = s as any;
    return pub;
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

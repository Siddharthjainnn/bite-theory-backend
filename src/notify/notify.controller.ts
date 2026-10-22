import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { WhatsAppService } from './whatsapp.service';
import { OutboxService } from './outbox.service';
import { NotifyService } from './notify.service';
import { TEMPLATES } from './notify.config';

/**
 * /api/notify — WhatsApp.
 *   GET  whatsapp/webhook   Meta's one-time verification (hub.challenge)
 *   POST whatsapp/webhook   delivery receipts + STOP/START (signature-checked)
 *   GET  status | log       admin: is it set up, what was sent
 *   POST test               admin: send a test alert to a number
 */
@Controller('notify')
export class NotifyController {
  constructor(
    private readonly wa: WhatsAppService,
    private readonly outbox: OutboxService,
    private readonly notify: NotifyService,
  ) {}

  @Get('whatsapp/webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && token === expected) {
      res
        .status(200)
        .type('text/plain')
        .send(String(challenge ?? ''));
      return;
    }
    res.status(403).send('Verification failed');
  }

  /* Meta can send bursts of receipts; the 60/min per-IP limit is for people. */
  @SkipThrottle()
  @Post('whatsapp/webhook')
  @HttpCode(200)
  webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') sig: string,
    @Body() body: unknown,
  ) {
    if (!this.wa.verifySignature(req.rawBody, sig))
      throw new ForbiddenException('Bad signature');
    return this.outbox.handleWebhook(body);
  }

  @UseGuards(AdminAuthGuard)
  @Get('status')
  async status() {
    const id = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    return {
      configured: this.wa.configured,
      phoneNumberId: id ? `${id.slice(0, 3)}•••${id.slice(-3)}` : null,
      apiVersion: process.env.WHATSAPP_API_VERSION || 'v25.0',
      appSecretSet: !!process.env.WHATSAPP_APP_SECRET,
      verifyTokenSet: !!process.env.WHATSAPP_VERIFY_TOKEN,
      siteUrl: NotifyService.siteUrl(),
      webhookPath: '/api/notify/whatsapp/webhook',
      templates: Object.values(TEMPLATES),
      counts: await this.outbox.counts(),
    };
  }

  @UseGuards(AdminAuthGuard)
  @Get('log')
  log(@Query('limit') limit?: string) {
    return this.outbox.recent(Number(limit) || 50);
  }

  @UseGuards(AdminAuthGuard)
  @Post('test')
  test(@Body() body: { phone?: unknown }) {
    if (typeof body?.phone !== 'string')
      throw new BadRequestException('Send { phone }');
    return this.notify.test(body.phone);
  }
}

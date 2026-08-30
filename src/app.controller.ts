import { Controller, Get, Post, Query, Req, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { AppService } from './app.service';
import { MailService } from './common/mail.service';
import { requireAdmin } from './common/req-auth.util';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly mail: MailService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Admin-only SMTP smoke test.
   *
   * MailService swallows every failure by design — an email must never break an
   * order — which also means a misconfigured mailbox fails completely silently.
   * This is the one place that reports the truth: whether the transporter was
   * built, and whether a real send actually resolved.
   *
   *   GET  /mail/status        → is SMTP configured at all?
   *   POST /mail/test?to=you@… → attempt one real send and report the error
   */
  @Get('mail/status')
  mailStatus(@Req() req: Request) {
    requireAdmin(req);
    return {
      ready: this.mail.isReady,
      host: process.env.SMTP_HOST || null,
      port: process.env.SMTP_PORT || '587',
      user: process.env.SMTP_USER || null,
      from: process.env.MAIL_FROM || process.env.SMTP_USER || null,
      hint: this.mail.isReady
        ? 'SMTP is configured. POST /mail/test?to=you@example.com to send one.'
        : 'Set SMTP_HOST, SMTP_USER and SMTP_PASS, then redeploy.',
    };
  }

  @Post('mail/test')
  async mailTest(@Req() req: Request, @Query('to') to?: string) {
    requireAdmin(req);
    if (!to) throw new BadRequestException('Pass ?to=you@example.com');
    if (!this.mail.isReady) {
      throw new BadRequestException(
        'SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and redeploy.',
      );
    }
    // Awaited, unlike MailService.send(), so the real SMTP error surfaces here
    // instead of disappearing into a log line.
    return this.mail.sendAndReport(
      to,
      'Bites Theory — SMTP test',
      '<p>If you are reading this, your mail service is working.</p>',
    );
  }
}

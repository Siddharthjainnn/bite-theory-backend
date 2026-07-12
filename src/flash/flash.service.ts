import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class FlashService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  /** The live deal right now, or null. Used by storefront AND checkout. */
  async current() {
    const rows = await this.dataSource.query(
      `SELECT id, title, discount_pct AS "discountPct", starts_at AS "startsAt", ends_at AS "endsAt"
         FROM flash_deals
        WHERE active = true AND now() BETWEEN starts_at AND ends_at
        ORDER BY id DESC LIMIT 1`);
    return rows[0] || null;
  }

  /** Admin: start a deal now for N minutes (deactivates any other). */
  async startNow(title: string, discountPct: number, minutes: number) {
    const pct = Number(discountPct);
    if (!(pct > 0 && pct <= 50)) throw new BadRequestException('discountPct must be 1–50');
    const mins = Math.min(Math.max(Number(minutes) || 120, 5), 24 * 60);
    await this.dataSource.query(`UPDATE flash_deals SET active = false WHERE active = true`);
    const rows = await this.dataSource.query(
      `INSERT INTO flash_deals (title, discount_pct, starts_at, ends_at, active)
       VALUES ($1,$2,now(),now() + ($3 || ' minutes')::interval,true) RETURNING *`,
      [title || `⚡ ${pct}% OFF`, pct, String(mins)]);
    return rows[0];
  }

  async stop() {
    await this.dataSource.query(`UPDATE flash_deals SET active = false WHERE active = true`);
    return { stopped: true };
  }
}

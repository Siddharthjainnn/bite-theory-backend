import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import {
  BANDS,
  Band,
  BandStats,
  DispatchConfig,
  EtaQuote,
  MIN_SAMPLES,
  StatPart,
  hourBand,
  normalizeDispatch,
  prepMinutes,
  quoteEta,
  summarize,
  planningMinPerKm,
} from './dispatch.algo';

/**
 * EtaService — the learned time model (PRD: "Time calculation").
 *
 * quote()     what to promise a customer right now
 * recompute() rebuild eta_stats from the last 30 days of delivered orders
 *
 * Kept free of OrdersService so OrdersService can depend on it.
 */
@Injectable()
export class EtaService {
  private readonly logger = new Logger(EtaService.name);
  private cache: { at: number; stats: Record<string, BandStats> } | null = null;
  private static readonly CACHE_MS = 5 * 60_000;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: SettingsService,
  ) {}

  async config(): Promise<{ cfg: DispatchConfig; settings: any }> {
    const settings = await this.settings.get();
    return { cfg: normalizeDispatch(settings.dispatchConfig), settings };
  }

  /** Learned stats for one band. Missing table (un-migrated DB) → empty, i.e. defaults. */
  async statsFor(band: Band): Promise<BandStats> {
    if (!this.cache || Date.now() - this.cache.at > EtaService.CACHE_MS) {
      const all: Record<string, BandStats> = {};
      try {
        const rows = await this.ds.query(
          `SELECT band, part, median, p80, n FROM eta_stats`,
        );
        for (const r of rows) {
          (all[r.band] ||= {})[r.part as StatPart] = {
            median: Number(r.median),
            p80: Number(r.p80),
            n: Number(r.n),
          };
        }
      } catch {
        /* eta_stats not migrated yet */
      }
      this.cache = { at: Date.now(), stats: all };
    }
    return this.cache.stats[band] || {};
  }

  /** Planning speed (minutes per straight-line km) for an instant. */
  async minPerKm(at = new Date()): Promise<number> {
    const { cfg, settings } = await this.config();
    return planningMinPerKm(
      await this.statsFor(hourBand(at, settings.timezone || 'Asia/Kolkata')),
      cfg,
    );
  }

  /** Orders the kitchen has accepted and not finished, excluding `exceptId`. */
  async ordersCooking(exceptId?: number): Promise<number> {
    const [r] = await this.ds.query(
      `SELECT COUNT(*)::int AS n FROM orders
        WHERE status IN ('order_received','order_confirmed','preparing_food')
          AND ($1::bigint IS NULL OR id <> $1)`,
      [exceptId ?? null],
    );
    return Number(r?.n || 0);
  }

  /** Prep minutes for cart lines (product ids + quantities; thalis use the default). */
  async prepFor(
    lines: { productId: number | null; quantity: number }[],
  ): Promise<number> {
    const { cfg, settings } = await this.config();
    const ids = lines
      .map((l) => l.productId)
      .filter((x): x is number => x != null);
    const map = new Map<number, number | null>();
    if (ids.length) {
      try {
        const rows = await this.ds.query(
          `SELECT id, prep_minutes FROM products WHERE id = ANY($1)`,
          [ids],
        );
        for (const r of rows)
          map.set(
            Number(r.id),
            r.prep_minutes != null ? Number(r.prep_minutes) : null,
          );
      } catch {
        /* prep_minutes not migrated yet */
      }
    }
    return prepMinutes(
      lines.map((l) => ({
        prepMinutes:
          l.productId != null ? (map.get(Number(l.productId)) ?? null) : null,
        quantity: l.quantity,
      })),
      Number(settings.avgPrepMinutes) || 20,
      cfg,
    );
  }

  /** The range to show and the promise to save. */
  async quote(input: {
    lines: { productId: number | null; quantity: number }[];
    distanceKm: number | null;
    at?: Date;
    exceptOrderId?: number;
  }): Promise<EtaQuote & { prepMin: number }> {
    const at = input.at ?? new Date();
    const { cfg, settings } = await this.config();
    const [prepMin, cooking, stats] = await Promise.all([
      this.prepFor(input.lines),
      this.ordersCooking(input.exceptOrderId),
      this.statsFor(hourBand(at, settings.timezone || 'Asia/Kolkata')),
    ]);
    return {
      ...quoteEta({
        prepMin,
        ordersCooking: cooking,
        distanceKm: input.distanceKm,
        stats,
        cfg,
      }),
      prepMin,
    };
  }

  /** When was the model last rebuilt? null = never. */
  async lastComputed(): Promise<Date | null> {
    try {
      const [r] = await this.ds.query(
        `SELECT MAX(computed_at) AS at FROM eta_stats`,
      );
      return r?.at ? new Date(r.at) : null;
    } catch {
      return null;
    }
  }

  /**
   * Rebuild eta_stats from the last 30 days. Each part is measured on the
   * orders that can measure it honestly:
   *   accept        placed → accepted
   *   prep_ratio    actual (accepted → ready) ÷ the estimate saved at checkout
   *   handoff       ready → picked up
   *   speed         minutes per straight-line km, pickup → delivered, on solo
   *                 runs only (a batched second stop would read as "slow")
   *   porter_arrival Porter booked → picked up
   * Outliers (forgotten taps, test orders) are clipped out before summarising.
   */
  async recompute(): Promise<
    { band: string; part: string; n: number; median: number; p80: number }[]
  > {
    const { settings } = await this.config();
    const tz = settings.timezone || 'Asia/Kolkata';
    const rows = await this.ds.query(
      `SELECT o.placed_at, o.accepted_at, o.ready_at, o.picked_up_at, o.delivered_at,
              o.distance_km, o.prep_estimate_min, o.delivery_provider, o.external_booked_at,
              (SELECT COUNT(*) FROM trip_stops s WHERE s.trip_id = o.trip_id)::int AS stops
         FROM orders o
        WHERE o.status = 'delivered' AND o.delivered_at > now() - interval '30 days'
        ORDER BY o.delivered_at DESC LIMIT 20000`,
    );

    const buckets: Record<string, number[]> = {};
    const push = (
      band: Band,
      part: StatPart,
      v: number,
      lo: number,
      hi: number,
    ) => {
      if (Number.isFinite(v) && v >= lo && v <= hi)
        (buckets[`${band}|${part}`] ||= []).push(v);
    };
    const mins = (a: unknown, b: unknown) =>
      a && b
        ? (new Date(b as string).getTime() - new Date(a as string).getTime()) /
          60000
        : NaN;

    for (const r of rows) {
      const band = hourBand(new Date(r.placed_at), tz);
      push(band, 'accept', mins(r.placed_at, r.accepted_at), 0, 60);
      if (r.prep_estimate_min > 0)
        push(
          band,
          'prep_ratio',
          mins(r.accepted_at, r.ready_at) / Number(r.prep_estimate_min),
          0.2,
          5,
        );
      push(band, 'handoff', mins(r.ready_at, r.picked_up_at), 0, 90);
      const km = Number(r.distance_km);
      if (km >= 0.3 && Number(r.stops) <= 1)
        push(band, 'speed', mins(r.picked_up_at, r.delivered_at) / km, 0.5, 30);
      if (r.delivery_provider === 'porter')
        push(
          band,
          'porter_arrival',
          mins(r.external_booked_at, r.picked_up_at),
          0,
          90,
        );
    }

    const out: {
      band: string;
      part: string;
      n: number;
      median: number;
      p80: number;
    }[] = [];
    await this.ds.transaction(async (mgr) => {
      await mgr.query(`DELETE FROM eta_stats`);
      for (const band of BANDS) {
        for (const part of [
          'accept',
          'prep_ratio',
          'handoff',
          'speed',
          'porter_arrival',
        ] as StatPart[]) {
          const v = buckets[`${band}|${part}`];
          if (!v?.length) continue;
          const s = summarize(v);
          await mgr.query(
            `INSERT INTO eta_stats (band, part, median, p80, n, computed_at) VALUES ($1,$2,$3,$4,$5, now())`,
            [band, part, s.median, s.p80, s.n],
          );
          out.push({ band, part, ...s });
        }
      }
      /* Marker row so "last computed" is known even with no history yet. */
      if (!out.length) {
        await mgr.query(
          `INSERT INTO eta_stats (band, part, median, p80, n, computed_at) VALUES ('none','marker',0,0,0, now())`,
        );
      }
    });
    this.cache = null;
    const trustedParts = out.filter((o) => o.n >= MIN_SAMPLES).length;
    this.logger.log(
      `ETA model rebuilt from ${rows.length} orders: ${out.length} stats, ${trustedParts} trusted.`,
    );
    return out;
  }
}

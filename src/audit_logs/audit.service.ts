import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Request } from 'express';
import { verifyAdminJwt } from '../common/admin-auth.guard';

/**
 * AuditService — one place to record "who changed what, when, and why".
 *
 * THE PROBLEM
 * -----------
 * audit_logs existed but only THREE actions ever wrote to it (refund,
 * refund_failed, soft_delete). Everything else that matters was invisible:
 * price changes, coupon edits, wallet adjustments, order status overrides,
 * settings changes, admin logins. With one person running the shop that's
 * survivable. The moment a kitchen manager and a support agent share the
 * panel, "who dropped the price to ₹1?" has no answer — and that is exactly
 * when you need one.
 *
 * DESIGN NOTES
 *  - Never throws. An audit failure must not roll back the business action it
 *    is describing; a lost log line is bad, a lost order is worse.
 *  - Records the ADMIN identity from the JWT when present, so entries say
 *    "Priya (kitchen_manager)" rather than a nameless "admin".
 *  - Stores a before/after diff for updates, not the whole row — the useful
 *    part is what CHANGED.
 */
@Injectable()
export class AuditService {
  constructor(private readonly dataSource: DataSource) {}

  /** Cached one-time check: does audit_logs have the `actor` column? */
  private actorColumn: boolean | null = null;
  private async hasActorColumn(): Promise<boolean> {
    if (this.actorColumn !== null) return this.actorColumn;
    try {
      const r = await this.dataSource.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'audit_logs' AND column_name = 'actor' LIMIT 1`);
      this.actorColumn = r.length > 0;
    } catch { this.actorColumn = false; }
    return this.actorColumn;
  }

  /** Identify the caller from the admin JWT (falls back to the master key). */
  private actorFrom(req?: Request): { actor: string; adminUserId: number | null } {
    if (!req) return { actor: 'system', adminUserId: null };
    const token =
      (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') || '';
    const p = token ? verifyAdminJwt(token) : null;
    if (p) {
      const who = p.name || p.email || `admin#${p.sub}`;
      return { actor: `${who} (${p.role || 'admin'})`, adminUserId: Number(p.sub) || null };
    }
    // master key or an unauthenticated internal call
    const hasKey = !!(req.headers['x-admin-key'] || token);
    return { actor: hasKey ? 'admin (master key)' : 'system', adminUserId: null };
  }

  /**
   * Record an action.
   * @param action  dotted verb, e.g. 'product.update', 'coupon.delete'
   * @param entity  table name, e.g. 'products'
   */
  async log(
    action: string,
    entity: string,
    entityId: number | string | null,
    details: Record<string, unknown> = {},
    req?: Request,
  ): Promise<void> {
    try {
      const { actor, adminUserId } = this.actorFrom(req);
      /* `actor` is added by 2026-07-16-audit-actor.sql. If that migration has
         not been applied yet, fall back to an insert without it rather than
         losing the audit row entirely — a log line without a name still beats
         no log line. */
      const hasActor = await this.hasActorColumn();
      if (hasActor) {
        await this.dataSource.query(
          `INSERT INTO audit_logs (admin_user_id, actor, action, entity, entity_id, details)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [adminUserId, actor, action, entity,
           entityId == null ? null : Number(entityId) || null,
           JSON.stringify(details)]);
      } else {
        await this.dataSource.query(
          `INSERT INTO audit_logs (admin_user_id, action, entity, entity_id, details)
           VALUES ($1,$2,$3,$4,$5)`,
          [adminUserId, action, entity,
           entityId == null ? null : Number(entityId) || null,
           JSON.stringify({ ...details, actor })]);
      }
    } catch (e: any) {
      // Deliberate: never let auditing break the thing it is auditing.
      // eslint-disable-next-line no-console
      console.error('[audit] failed to record', action, e?.message || e);
    }
  }

  /**
   * Diff two objects and log only what actually changed. Returns the diff so
   * callers can skip logging no-op saves.
   */
  async logUpdate(
    entity: string,
    entityId: number | string,
    before: Record<string, any>,
    after: Record<string, any>,
    req?: Request,
    watch?: string[],
  ): Promise<Record<string, { from: any; to: any }>> {
    const keys = watch && watch.length ? watch : Object.keys(after);
    const changes: Record<string, { from: any; to: any }> = {};
    for (const k of keys) {
      if (after[k] === undefined) continue;
      const a = before?.[k];
      const b = after[k];
      // loose compare so 100 vs '100' from a form post isn't a false positive
      if (String(a ?? '') !== String(b ?? '')) changes[k] = { from: a ?? null, to: b };
    }
    if (Object.keys(changes).length) {
      await this.log(`${entity.replace(/s$/, '')}.update`, entity, entityId, { changes }, req);
    }
    return changes;
  }
}

import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Request } from 'express';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit_logs/audit.service';
import { returned } from '../common/sql.util';
import {
  billTotals, businessDate, cleanMobile, financialYearShort, formatBillNo,
  formatToken, round2, tokenFromCounter,
} from './pos.math';
import {
  CopyOutletPricesDto, CreatePosBillDto, OutletDto, SaveOutletPricesDto,
} from './pos.dto';

export interface PosActor { id: number | null; name: string }

/** the price a customer sees on the website: offer price when it's a real discount */
const SITE_PRICE_SQL = `CASE WHEN p.offer_price > 0 AND p.offer_price < p.price
                             THEN p.offer_price ELSE p.price END`;

const OUTLET_COLS = `id, code, name, address, phone, gstin, fssai,
  bill_footer AS "billFooter", day_starts_at AS "dayStartsAt",
  print_mode AS "printMode", kot_copies AS "kotCopies",
  is_active AS "isActive", sort_order AS "sortOrder"`;

const MAX_REPORT_DAYS = 366;

const ymd = (s: unknown): string | null =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;

/** CSV cell: quoted, and a leading = + - @ neutralised so a typed customer
 *  name can never run as a spreadsheet formula. */
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

@Injectable()
export class PosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /* ════════════════════════ outlets ════════════════════════ */

  async listOutlets(includeInactive = false) {
    return this.dataSource.query(
      `SELECT ${OUTLET_COLS} FROM outlets
        ${includeInactive ? '' : 'WHERE is_active'}
        ORDER BY sort_order, id`);
  }

  private async outletOrThrow(id: number, mgr: EntityManager | DataSource = this.dataSource) {
    const o = (await mgr.query(`SELECT ${OUTLET_COLS} FROM outlets WHERE id = $1`, [id]))[0];
    if (!o) throw new NotFoundException('Outlet not found.');
    return o;
  }

  async saveOutlet(id: number | null, dto: OutletDto, req?: Request) {
    const code = dto.code?.trim().toUpperCase();
    const name = dto.name?.trim();
    if (id === null && (!code || !name)) {
      throw new BadRequestException('Give the outlet a name and a 2–3 letter code (e.g. BKW).');
    }
    const fields: Record<string, unknown> = {
      code, name,
      address: dto.address?.trim(),
      phone: dto.phone?.trim(),
      gstin: dto.gstin?.trim().toUpperCase(),
      fssai: dto.fssai?.trim(),
      bill_footer: dto.billFooter?.trim(),
      day_starts_at: dto.dayStartsAt,
      print_mode: dto.printMode,
      kot_copies: dto.kotCopies,
      is_active: dto.isActive,
      sort_order: dto.sortOrder,
    };
    if (fields.gstin && !/^[0-9A-Z]{15}$/.test(String(fields.gstin))) {
      throw new BadRequestException('GSTIN must be 15 letters/digits.');
    }
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (id !== null && code) {
      /* the code is printed on every bill number already issued — changing it
         would split one GST series into two, so it's fixed once bills exist */
      const used = await this.dataSource.query(
        `SELECT 1 FROM pos_bills b JOIN outlets o ON o.id = b.outlet_id
          WHERE b.outlet_id = $1 AND o.code <> $2 LIMIT 1`, [id, code]);
      if (used.length) {
        throw new BadRequestException(
          'This outlet already has bills, so its code can no longer change (it is part of every bill number).');
      }
    }
    try {
      let row: any;
      if (id === null) {
        const cols = keys.join(', ');
        const params = keys.map((_, i) => `$${i + 1}`).join(', ');
        row = (await this.dataSource.query(
          `INSERT INTO outlets (${cols}) VALUES (${params}) RETURNING id`, keys.map((k) => fields[k])))[0];
      } else {
        await this.outletOrThrow(id);
        if (keys.length) {
          const set = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
          await this.dataSource.query(
            `UPDATE outlets SET ${set}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => fields[k])]);
        }
        row = { id };
      }
      await this.audit.log(id === null ? 'outlet.create' : 'outlet.update', 'outlets', row.id, { ...dto }, req);
      return this.outletOrThrow(Number(row.id));
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException(`Another outlet already uses the code ${code}.`);
      throw e;
    }
  }

  /** The rate list: every product, with this outlet's price where it differs. */
  async outletPrices(outletId: number) {
    await this.outletOrThrow(outletId);
    const rows = await this.dataSource.query(
      `SELECT p.id::int AS "productId", p.name, p.status, p.is_veg AS "isVeg",
              c.id::int AS "categoryId", c.name AS "categoryName",
              ${SITE_PRICE_SQL}::float AS "sitePrice",
              op.price::float AS "outletPrice",
              COALESCE(op.is_available, true) AS "isAvailable"
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN outlet_prices op ON op.product_id = p.id AND op.outlet_id = $1
        ORDER BY c.sort_order NULLS LAST, c.id, p.sort_order, p.name`, [outletId]);
    return rows;
  }

  async saveOutletPrices(outletId: number, dto: SaveOutletPricesDto, req?: Request) {
    await this.outletOrThrow(outletId);
    let changed = 0;
    await this.dataSource.transaction(async (mgr) => {
      for (const r of dto.prices) {
        const price = r.price === null || r.price === undefined || Number(r.price) <= 0
          ? null : round2(Number(r.price));
        if (price === null && r.isAvailable) {
          // same as the website and on sale → no row needed
          const res = await mgr.query(
            `DELETE FROM outlet_prices WHERE outlet_id = $1 AND product_id = $2`, [outletId, r.productId]);
          changed += Number(res?.[1] ?? 0);
          continue;
        }
        await mgr.query(
          `INSERT INTO outlet_prices (outlet_id, product_id, price, is_available, updated_at)
           SELECT $1, p.id, $3, $4, now() FROM products p WHERE p.id = $2
           ON CONFLICT (outlet_id, product_id)
             DO UPDATE SET price = EXCLUDED.price, is_available = EXCLUDED.is_available, updated_at = now()`,
          [outletId, r.productId, price, r.isAvailable]);
        changed++;
      }
    });
    await this.audit.log('outlet.prices', 'outlets', outletId, { rows: dto.prices.length }, req);
    return { ok: true, changed };
  }

  async copyOutletPrices(outletId: number, dto: CopyOutletPricesDto, req?: Request) {
    if (outletId === dto.fromOutletId) throw new BadRequestException('Pick a different outlet to copy from.');
    await this.outletOrThrow(outletId);
    await this.outletOrThrow(dto.fromOutletId);
    await this.dataSource.transaction(async (mgr) => {
      await mgr.query(`DELETE FROM outlet_prices WHERE outlet_id = $1`, [outletId]);
      await mgr.query(
        `INSERT INTO outlet_prices (outlet_id, product_id, price, is_available, updated_at)
         SELECT $1, product_id, price, is_available, now() FROM outlet_prices WHERE outlet_id = $2`,
        [outletId, dto.fromOutletId]);
    });
    await this.audit.log('outlet.prices.copy', 'outlets', outletId, { from: dto.fromOutletId }, req);
    return this.outletPrices(outletId);
  }

  /* ════════════════════════ counter ════════════════════════ */

  /** What the till shows: only dishes on sale at this outlet, at its rates. */
  async menu(outletId: number) {
    const outlet = await this.outletOrThrow(outletId);
    const items = await this.dataSource.query(
      `SELECT p.id, p.name, p.is_veg AS "isVeg", p.image,
              c.id AS "categoryId", c.name AS "categoryName",
              COALESCE(op.price, ${SITE_PRICE_SQL})::float AS price,
              ${SITE_PRICE_SQL}::float AS "sitePrice"
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN outlet_prices op ON op.product_id = p.id AND op.outlet_id = $1
        WHERE p.status = 'active' AND COALESCE(op.is_available, true)
          AND COALESCE(op.price, ${SITE_PRICE_SQL}) > 0
        ORDER BY c.sort_order NULLS LAST, c.id, p.sort_order, p.name`, [outletId]);
    const cats = new Map<number, { id: number; name: string }>();
    for (const i of items) {
      if (i.categoryId != null && !cats.has(Number(i.categoryId))) {
        cats.set(Number(i.categoryId), { id: Number(i.categoryId), name: i.categoryName });
      }
    }
    const cfg: any = await this.settings.get();
    return {
      outlet,
      categories: [...cats.values()],
      items: items.map((i: any) => ({ ...i, id: Number(i.id), categoryId: i.categoryId == null ? null : Number(i.categoryId) })),
      tax: { gstEnabled: !!cfg.gstEnabled, gstRate: Number(cfg.gstRate ?? 5), gstInclusive: cfg.gstInclusive !== false },
      today: await this.dayStats(outletId, businessDate(new Date(), outlet.dayStartsAt)),
    };
  }

  private async dayStats(outletId: number, date: string) {
    const r = (await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'paid')::int AS bills,
              COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0)::float AS sales,
              (SELECT token_no FROM pos_bills WHERE outlet_id = $1 AND business_date = $2
                ORDER BY id DESC LIMIT 1) AS "lastToken"
         FROM pos_bills WHERE outlet_id = $1 AND business_date = $2`, [outletId, date]))[0];
    return { date, bills: r.bills, sales: r.sales, lastToken: r.lastToken == null ? null : Number(r.lastToken) };
  }

  /** Next value of a per-outlet counter. The row lock is held until the bill
   *  commits, so two tills can never get the same token or bill number — and
   *  a failed bill rolls its numbers back, leaving no gap in the series. */
  private async nextCounter(mgr: EntityManager, outletId: number, scope: string): Promise<number> {
    const [row] = await mgr.query(
      `INSERT INTO pos_counters (outlet_id, scope, last_number) VALUES ($1, $2, 1)
       ON CONFLICT (outlet_id, scope)
         DO UPDATE SET last_number = pos_counters.last_number + 1, updated_at = now()
       RETURNING last_number`, [outletId, scope]);
    return Number(row.last_number);
  }

  async createBill(dto: CreatePosBillDto, actor: PosActor) {
    const mobileRaw = dto.customerMobile?.trim();
    const mobile = mobileRaw ? cleanMobile(mobileRaw) : null;
    if (mobileRaw && !mobile) throw new BadRequestException('That mobile number doesn\'t look right — leave it blank or enter 10 digits.');

    /* merge repeats of the same dish into one line */
    const qty = new Map<number, number>();
    for (const i of dto.items) qty.set(i.productId, (qty.get(i.productId) || 0) + i.quantity);
    if ([...qty.values()].some((q) => q > 999)) throw new BadRequestException('Quantity too large.');

    const cfg: any = await this.settings.get();
    const tax = { gstEnabled: !!cfg.gstEnabled, gstRate: Number(cfg.gstRate ?? 5), gstInclusive: cfg.gstInclusive !== false };

    if (dto.clientRef) {
      const prior = await this.billIdByRef(dto.outletId, dto.clientRef);
      if (prior) return this.getBill(prior);
    }

    try {
      const billId = await this.dataSource.transaction(async (mgr) => {
        const outlet = (await mgr.query(
          `SELECT id, code, day_starts_at AS "dayStartsAt", is_active AS "isActive"
             FROM outlets WHERE id = $1`, [dto.outletId]))[0];
        if (!outlet) throw new NotFoundException('Outlet not found.');
        if (!outlet.isActive) throw new BadRequestException('This outlet is switched off in Admin → Outlets.');

        /* price from the database, never from the till */
        const rows = await mgr.query(
          `SELECT p.id, p.name, p.is_veg AS "isVeg", c.name AS "categoryName",
                  COALESCE(op.price, ${SITE_PRICE_SQL})::numeric AS price
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             LEFT JOIN outlet_prices op ON op.product_id = p.id AND op.outlet_id = $1
            WHERE p.id = ANY($2::bigint[]) AND p.status = 'active'
              AND COALESCE(op.is_available, true)`,
          [dto.outletId, [...qty.keys()]]);
        const byId = new Map<number, any>(rows.map((r: any) => [Number(r.id), r]));
        const lines = [...qty.entries()].map(([pid, q]) => {
          const p = byId.get(pid);
          if (!p || !(Number(p.price) > 0)) {
            throw new BadRequestException(`${p?.name || 'A dish in this bill'} is not on sale at this counter any more. Remove it and try again.`);
          }
          const unit = round2(Number(p.price));
          return { productId: pid, name: p.name, category: p.categoryName, isVeg: p.isVeg, unit, qty: q, line: round2(unit * q) };
        });

        const subtotal = round2(lines.reduce((s, l) => s + l.line, 0));
        const t = billTotals(subtotal, tax, dto.discount);
        const now = new Date();
        const day = businessDate(now, outlet.dayStartsAt);
        const fy = financialYearShort(day);
        const token = tokenFromCounter(await this.nextCounter(mgr, outlet.id, `token:${day}`));
        const billNo = formatBillNo(outlet.code, fy, await this.nextCounter(mgr, outlet.id, `bill:${fy}`));

        const [bill] = await mgr.query(
          `INSERT INTO pos_bills
             (outlet_id, bill_no, token_no, business_date, order_type, customer_name, customer_mobile,
              note, item_count, subtotal, discount, discount_reason, taxable_amount, tax_rate, cgst, sgst,
              gst_inclusive, round_off, total, payment_method, cashier_id, cashier_name, client_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
           RETURNING id`,
          [outlet.id, billNo, token, day, dto.orderType || 'takeaway',
           dto.customerName?.trim() || null, mobile, dto.note?.trim() || null,
           lines.reduce((s, l) => s + l.qty, 0),
           t.subtotal, t.discount, t.discount > 0 ? (dto.discount?.reason?.trim() || null) : null,
           t.taxableAmount, t.taxRate, t.cgst, t.sgst, tax.gstInclusive, t.roundOff, t.total,
           dto.paymentMethod, actor.id, actor.name, dto.clientRef || null]);

        for (const l of lines) {
          await mgr.query(
            `INSERT INTO pos_bill_items
               (bill_id, product_id, product_name, category_name, is_veg, unit_price, quantity, line_total)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [bill.id, l.productId, l.name, l.category || null, l.isVeg ?? null, l.unit, l.qty, l.line]);
        }
        return Number(bill.id);
      });
      return this.getBill(billId);
    } catch (e: any) {
      /* the same click arrived twice at the same moment: the second insert hit
         the client_ref index and rolled back (numbers included) — hand back
         the bill the first one made */
      if (e?.code === '23505' && dto.clientRef) {
        const prior = await this.billIdByRef(dto.outletId, dto.clientRef);
        if (prior) return this.getBill(prior);
      }
      throw e;
    }
  }

  private async billIdByRef(outletId: number, ref: string): Promise<number | null> {
    const r = await this.dataSource.query(
      `SELECT id FROM pos_bills WHERE outlet_id = $1 AND client_ref = $2`, [outletId, ref]);
    return r[0] ? Number(r[0].id) : null;
  }

  async getBill(id: number) {
    const b = (await this.dataSource.query(
      `SELECT b.*, b.business_date::text AS bd FROM pos_bills b WHERE b.id = $1`, [id]))[0];
    if (!b) throw new NotFoundException('Bill not found.');
    const [outlet, items] = await Promise.all([
      this.outletOrThrow(Number(b.outlet_id)),
      this.dataSource.query(
        `SELECT product_id::int AS "productId", product_name AS name, category_name AS category,
                is_veg AS "isVeg", unit_price::float AS "unitPrice", quantity, line_total::float AS "lineTotal"
           FROM pos_bill_items WHERE bill_id = $1 ORDER BY id`, [id]),
    ]);
    return this.billView(b, outlet, items);
  }

  private billView(b: any, outlet: any, items: any[]) {
    const n = (v: unknown) => Number(v ?? 0);
    return {
      id: Number(b.id),
      outletId: Number(b.outlet_id),
      outlet,
      billNo: b.bill_no,
      token: Number(b.token_no),
      tokenLabel: formatToken(Number(b.token_no)),
      businessDate: b.bd,
      orderType: b.order_type,
      customerName: b.customer_name,
      customerMobile: b.customer_mobile,
      note: b.note,
      itemCount: n(b.item_count),
      subtotal: n(b.subtotal),
      discount: n(b.discount),
      discountReason: b.discount_reason,
      taxableAmount: n(b.taxable_amount),
      taxRate: n(b.tax_rate),
      cgst: n(b.cgst),
      sgst: n(b.sgst),
      gstInclusive: !!b.gst_inclusive,
      roundOff: n(b.round_off),
      total: n(b.total),
      paymentMethod: b.payment_method,
      status: b.status,
      cancelReason: b.cancel_reason,
      cancelledAt: b.cancelled_at,
      cancelledBy: b.cancelled_by,
      cashierName: b.cashier_name,
      printCount: n(b.print_count),
      createdAt: b.created_at,
      items,
    };
  }

  /** The till prints straight after saving; this counts each print so a
   *  reprint is marked DUPLICATE on paper and visible in the bill list. */
  async markPrinted(id: number) {
    const rows = returned(await this.dataSource.query(
      `UPDATE pos_bills SET print_count = print_count + 1 WHERE id = $1 RETURNING id`, [id]));
    if (!rows.length) throw new NotFoundException('Bill not found.');
    return this.getBill(id);
  }

  /** One business day of bills at an outlet, newest first (for reprint / cancel). */
  async listBills(outletId: number, date?: string, q?: string) {
    const outlet = await this.outletOrThrow(outletId);
    const day = ymd(date) || businessDate(new Date(), outlet.dayStartsAt);
    const term = (q || '').trim();
    const params: unknown[] = [outletId, day];
    let filter = '';
    if (term) {
      params.push(term.replace(/^0+(?=\d)/, ''), `%${term.toUpperCase()}%`);
      filter = `AND (b.token_no::text = $3 OR b.bill_no LIKE $4 OR b.customer_mobile LIKE $4)`;
    }
    const bills = await this.dataSource.query(
      `SELECT b.*, b.business_date::text AS bd FROM pos_bills b
        WHERE b.outlet_id = $1 AND b.business_date = $2 ${filter}
        ORDER BY b.id DESC LIMIT 500`, params);
    if (!bills.length) return { date: day, outlet, bills: [], stats: await this.dayStats(outletId, day) };
    const items = await this.dataSource.query(
      `SELECT bill_id, product_id::int AS "productId", product_name AS name, category_name AS category,
              is_veg AS "isVeg", unit_price::float AS "unitPrice", quantity, line_total::float AS "lineTotal"
         FROM pos_bill_items WHERE bill_id = ANY($1::bigint[]) ORDER BY id`,
      [bills.map((b: any) => b.id)]);
    const byBill = new Map<string, any[]>();
    for (const it of items) {
      const k = String(it.bill_id);
      delete it.bill_id;
      byBill.set(k, [...(byBill.get(k) || []), it]);
    }
    return {
      date: day,
      outlet,
      bills: bills.map((b: any) => this.billView(b, outlet, byBill.get(String(b.id)) || [])),
      stats: await this.dayStats(outletId, day),
    };
  }

  /**
   * Who may cancel a bill. The admin panel sends the shared key with every
   * call (which skips the section guard), so this is checked here against the
   * caller's own JWT role: a Cashier can bill but cannot cancel — otherwise a
   * cash bill could be printed, paid, cancelled and the cash kept.
   *   super_admin            → yes
   *   role with saved access → only if it includes "outlets"
   *   built-in roles         → kitchen / finance managers
   *   master key, no login   → yes (break-glass)
   */
  async assertCanCancel(role: string | null) {
    if (role === null || role === 'super_admin') return;
    const rows = await this.dataSource.query(
      `SELECT sections FROM roles WHERE lower(replace(trim(name), ' ', '_')) = $1 AND sections IS NOT NULL`, [role]);
    const saved: unknown = rows[0]?.sections;
    const ok = Array.isArray(saved) && saved.length
      ? saved.includes('outlets')
      : ['kitchen_manager', 'finance_manager'].includes(role);
    if (!ok) {
      throw new ForbiddenException(
        'Only a manager can cancel a bill. Ask a manager, or a super admin can give your role "Outlets & Rates" access.');
    }
  }

  /** Bills are never deleted (GST series). A cancelled bill keeps its number,
   *  drops out of sales, and is listed on the report with who and why. */
  async cancelBill(id: number, reason: string, actor: PosActor, req?: Request) {
    const why = (reason || '').trim();
    if (why.length < 3) throw new BadRequestException('Write a short reason for cancelling.');
    const rows = returned(await this.dataSource.query(
      `UPDATE pos_bills SET status = 'cancelled', cancel_reason = $2, cancelled_at = now(), cancelled_by = $3
        WHERE id = $1 AND status = 'paid' RETURNING id, bill_no, total`, [id, why, actor.name]));
    if (!rows.length) {
      const exists = await this.dataSource.query(`SELECT status FROM pos_bills WHERE id = $1`, [id]);
      if (!exists.length) throw new NotFoundException('Bill not found.');
      throw new BadRequestException('This bill is already cancelled.');
    }
    await this.audit.log('pos.bill.cancel', 'pos_bills', id,
      { billNo: rows[0].bill_no, total: Number(rows[0].total), reason: why }, req);
    return this.getBill(id);
  }

  /* ════════════════════════ reports ════════════════════════ */

  private range(from?: string, to?: string) {
    const today = businessDate(new Date(), 4);
    const f = ymd(from) || today;
    const t = ymd(to) || f;
    if (t < f) throw new BadRequestException('The end date is before the start date.');
    const days = (Date.parse(t) - Date.parse(f)) / 86_400_000 + 1;
    if (days > MAX_REPORT_DAYS) throw new BadRequestException('Pick a range of one year or less.');
    return { from: f, to: t };
  }

  async summary(from?: string, to?: string, outletId?: number | null) {
    const r = this.range(from, to);
    const params: unknown[] = [r.from, r.to];
    let where = `b.business_date BETWEEN $1 AND $2`;
    if (outletId) { params.push(outletId); where += ` AND b.outlet_id = $3`; }
    const paid = `${where} AND b.status = 'paid'`;
    const q = (sql: string) => this.dataSource.query(sql, params);

    const [totals, byPayment, byOutlet, byDay, byHour, byType, topItems, byCategory, cancelled] = await Promise.all([
      q(`SELECT COUNT(*)::int AS bills,
                COALESCE(SUM(total),0)::float AS "netSales",
                COALESCE(SUM(subtotal),0)::float AS subtotal,
                COALESCE(SUM(discount),0)::float AS discount,
                COALESCE(SUM(taxable_amount),0)::float AS taxable,
                COALESCE(SUM(cgst),0)::float AS cgst,
                COALESCE(SUM(sgst),0)::float AS sgst,
                COALESCE(SUM(round_off),0)::float AS "roundOff",
                COALESCE(SUM(item_count),0)::int AS items
           FROM pos_bills b WHERE ${paid}`),
      q(`SELECT payment_method AS method, COUNT(*)::int AS bills, SUM(total)::float AS amount
           FROM pos_bills b WHERE ${paid} GROUP BY 1 ORDER BY amount DESC`),
      q(`SELECT o.id AS "outletId", o.name, o.code, o.gstin,
                COUNT(b.id) FILTER (WHERE b.status = 'paid')::int AS bills,
                COALESCE(SUM(b.total) FILTER (WHERE b.status = 'paid'),0)::float AS amount,
                COALESCE(SUM(b.discount) FILTER (WHERE b.status = 'paid'),0)::float AS discount,
                COALESCE(SUM(b.taxable_amount) FILTER (WHERE b.status = 'paid'),0)::float AS taxable,
                COALESCE(SUM(b.cgst) FILTER (WHERE b.status = 'paid'),0)::float AS cgst,
                COALESCE(SUM(b.sgst) FILTER (WHERE b.status = 'paid'),0)::float AS sgst,
                COUNT(b.id) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
                MIN(b.bill_no) AS "firstBillNo", MAX(b.bill_no) AS "lastBillNo"
           FROM pos_bills b JOIN outlets o ON o.id = b.outlet_id
          WHERE ${where} GROUP BY o.id ORDER BY o.sort_order, o.id`),
      q(`SELECT business_date::text AS date, COUNT(*)::int AS bills, SUM(total)::float AS amount
           FROM pos_bills b WHERE ${paid} GROUP BY 1 ORDER BY 1`),
      q(`SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
                COUNT(*)::int AS bills, SUM(total)::float AS amount
           FROM pos_bills b WHERE ${paid} GROUP BY 1 ORDER BY 1`),
      q(`SELECT order_type AS type, COUNT(*)::int AS bills, SUM(total)::float AS amount
           FROM pos_bills b WHERE ${paid} GROUP BY 1`),
      q(`SELECT i.product_id::int AS "productId", i.product_name AS name, MAX(i.category_name) AS category,
                SUM(i.quantity)::int AS qty, SUM(i.line_total)::float AS amount
           FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id
          WHERE ${paid} GROUP BY 1, 2 ORDER BY qty DESC, amount DESC LIMIT 50`),
      q(`SELECT COALESCE(i.category_name, 'Other') AS category,
                SUM(i.quantity)::int AS qty, SUM(i.line_total)::float AS amount
           FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id
          WHERE ${paid} GROUP BY 1 ORDER BY amount DESC`),
      q(`SELECT b.id::int AS id, b.bill_no AS "billNo", b.token_no AS token, b.total::float AS total,
                b.cancel_reason AS reason, b.cancelled_by AS "cancelledBy", b.cancelled_at AS "cancelledAt",
                b.cashier_name AS "cashierName", o.name AS outlet
           FROM pos_bills b JOIN outlets o ON o.id = b.outlet_id
          WHERE ${where} AND b.status = 'cancelled' ORDER BY b.cancelled_at DESC LIMIT 100`),
    ]);

    const t = totals[0];
    const cancelledAmount = (await q(
      `SELECT COALESCE(SUM(total),0)::float AS a, COUNT(*)::int AS n
         FROM pos_bills b WHERE ${where} AND b.status = 'cancelled'`))[0];
    return {
      range: r,
      outletId: outletId || null,
      totals: {
        ...t,
        tax: round2(t.cgst + t.sgst),
        avgBill: t.bills ? round2(t.netSales / t.bills) : 0,
        cancelledBills: cancelledAmount.n,
        cancelledAmount: cancelledAmount.a,
      },
      byPayment, byOutlet, byDay, byHour, byType, topItems, byCategory, cancelled,
    };
  }

  async billsCsv(from?: string, to?: string, outletId?: number | null): Promise<string> {
    const r = this.range(from, to);
    const params: unknown[] = [r.from, r.to];
    let where = `b.business_date BETWEEN $1 AND $2`;
    if (outletId) { params.push(outletId); where += ` AND b.outlet_id = $3`; }
    const rows = await this.dataSource.query(
      `SELECT b.business_date::text AS day,
              to_char(b.created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS time,
              o.name AS outlet, o.gstin, b.bill_no, lpad(b.token_no::text, 3, '0') AS token,
              b.order_type, b.payment_method, b.status, b.item_count,
              b.subtotal, b.discount, b.taxable_amount, b.tax_rate, b.cgst, b.sgst, b.round_off, b.total,
              b.customer_name, b.customer_mobile, b.cashier_name, b.cancel_reason,
              (SELECT string_agg(i.quantity || ' x ' || i.product_name, '; ' ORDER BY i.id)
                 FROM pos_bill_items i WHERE i.bill_id = b.id) AS items
         FROM pos_bills b JOIN outlets o ON o.id = b.outlet_id
        WHERE ${where} ORDER BY b.outlet_id, b.id`, params);
    const head = ['Date', 'Time', 'Outlet', 'GSTIN', 'Bill No', 'Token', 'Type', 'Payment', 'Status', 'Items',
      'Subtotal', 'Discount', 'Taxable', 'GST %', 'CGST', 'SGST', 'Round off', 'Total',
      'Customer', 'Mobile', 'Cashier', 'Cancel reason', 'Dishes'];
    const keys = ['day', 'time', 'outlet', 'gstin', 'bill_no', 'token', 'order_type', 'payment_method', 'status',
      'item_count', 'subtotal', 'discount', 'taxable_amount', 'tax_rate', 'cgst', 'sgst', 'round_off', 'total',
      'customer_name', 'customer_mobile', 'cashier_name', 'cancel_reason', 'items'];
    return [head.map(csvCell).join(','), ...rows.map((x: any) => keys.map((k) => csvCell(x[k])).join(','))]
      .join('\r\n') + '\r\n';
  }

  async itemsCsv(from?: string, to?: string, outletId?: number | null): Promise<string> {
    const r = this.range(from, to);
    const params: unknown[] = [r.from, r.to];
    let where = `b.business_date BETWEEN $1 AND $2 AND b.status = 'paid'`;
    if (outletId) { params.push(outletId); where += ` AND b.outlet_id = $3`; }
    const rows = await this.dataSource.query(
      `SELECT o.name AS outlet, COALESCE(i.category_name, 'Other') AS category, i.product_name AS dish,
              SUM(i.quantity)::int AS qty, SUM(i.line_total)::numeric(12,2) AS amount
         FROM pos_bill_items i JOIN pos_bills b ON b.id = i.bill_id JOIN outlets o ON o.id = b.outlet_id
        WHERE ${where} GROUP BY 1, 2, 3 ORDER BY 1, qty DESC`, params);
    const head = ['Outlet', 'Category', 'Dish', 'Qty sold', 'Amount (before bill discount)'];
    return [head.map(csvCell).join(','),
      ...rows.map((x: any) => [x.outlet, x.category, x.dish, x.qty, x.amount].map(csvCell).join(','))]
      .join('\r\n') + '\r\n';
  }
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService, ReportFilters } from './reports.service';
import { AdminAuthGuard } from '../common/admin-auth.guard';

/**
 * All reports are admin-only and read-only. Every endpoint takes the SAME
 * filter query string, so a date range set on one screen means the same thing
 * on every other.
 *
 *   ?from=2026-07-01&to=2026-07-16&categoryId=3&paymentMethod=online
 */
@UseGuards(AdminAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  private filters(q: any): ReportFilters {
    return {
      from: q.from || undefined,
      to: q.to || undefined,
      categoryId: q.categoryId ? Number(q.categoryId) : undefined,
      productId: q.productId ? Number(q.productId) : undefined,
      paymentMethod: q.paymentMethod || undefined,
      status: q.status || undefined,
      riderId: q.riderId ? Number(q.riderId) : undefined,
      couponCode: q.couponCode || undefined,
    };
  }

  /** One call for the whole dashboard — avoids 10 round trips on load. */
  @Get('dashboard')
  dashboard(@Query() q: any) { return this.service.dashboard(this.filters(q)); }

  @Get('summary')
  summary(@Query() q: any) { return this.service.summary(this.filters(q)); }

  @Get('sales-by-day')
  salesByDay(@Query() q: any) { return this.service.salesByDay(this.filters(q)); }

  @Get('orders-by-hour')
  ordersByHour(@Query() q: any) { return this.service.ordersByHour(this.filters(q)); }

  @Get('orders-by-weekday')
  ordersByWeekday(@Query() q: any) { return this.service.ordersByWeekday(this.filters(q)); }

  @Get('top-items')
  topItems(@Query() q: any) {
    return this.service.topItems(this.filters(q), q.limit ? Number(q.limit) : 20);
  }

  @Get('dead-items')
  deadItems(@Query() q: any) { return this.service.deadItems(this.filters(q)); }

  @Get('sales-by-category')
  salesByCategory(@Query() q: any) { return this.service.salesByCategory(this.filters(q)); }

  @Get('repeat-customers')
  repeatCustomers(@Query() q: any) { return this.service.repeatCustomers(this.filters(q)); }

  @Get('top-customers')
  topCustomers(@Query() q: any) {
    return this.service.topCustomers(this.filters(q), q.limit ? Number(q.limit) : 20);
  }

  @Get('new-vs-returning')
  newVsReturning(@Query() q: any) { return this.service.newVsReturning(this.filters(q)); }

  @Get('payments')
  payments(@Query() q: any) { return this.service.paymentBreakdown(this.filters(q)); }

  @Get('coupons')
  coupons(@Query() q: any) { return this.service.couponPerformance(this.filters(q)); }

  @Get('referrals')
  referrals(@Query() q: any) { return this.service.referralReport(this.filters(q)); }

  @Get('operations')
  operations(@Query() q: any) { return this.service.operations(this.filters(q)); }

  @Get('riders')
  riders(@Query() q: any) { return this.service.riderReport(this.filters(q)); }

  @Get('cancellations')
  cancellations(@Query() q: any) { return this.service.cancellations(this.filters(q)); }

  /* ── the reports you run the business on ── */

  /** Where the money lives — orders/revenue by pincode. */
  @Get('areas')
  areas(@Query() q: any) { return this.service.salesByArea(this.filters(q)); }

  /** What sells vs what disappoints — ratings per dish. */
  @Get('item-ratings')
  itemRatings(@Query() q: any) { return this.service.itemRatings(this.filters(q)); }

  @Get('rating-trend')
  ratingTrend(@Query() q: any) { return this.service.ratingTrend(this.filters(q)); }

  /** WHERE the minutes go — dwell time per status. */
  @Get('bottlenecks')
  bottlenecks(@Query() q: any) { return this.service.statusDwellTimes(this.filters(q)); }

  /** Low/out of stock right now. */
  @Get('stock')
  stock() { return this.service.stockReport(); }

  /** Wallet as a liability — money you still owe in food. */
  @Get('wallet')
  wallet(@Query() q: any) { return this.service.walletReport(this.filters(q)); }

  @Get('support')
  support(@Query() q: any) { return this.service.supportReport(this.filters(q)); }

  /** Monthly retention cohorts — the most honest number you have. */
  @Get('cohorts')
  cohorts() { return this.service.cohorts(); }

  /** How much margin is leaking out as discounts. */
  @Get('discount-leakage')
  discountLeakage(@Query() q: any) { return this.service.discountLeakage(this.filters(q)); }

  /** Flat, wide rows for CSV/Excel — pivot it yourself, no dev needed. */
  @Get('export/orders')
  exportOrders(@Query() q: any) {
    return this.service.orderExport(this.filters(q), q.limit ? Number(q.limit) : 5000);
  }
}

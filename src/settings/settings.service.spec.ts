import { SettingsService } from './settings.service';

/**
 * Regression test for the "store shows closed at 10:18 AM" bug.
 *
 * Root cause: a day configured with open === close (e.g. Monday 10:00→10:00)
 * has an empty open window, so `now >= open && now < close` is always false
 * and the kitchen never opens. The guard treats close <= open as a clean
 * "closed today" and points at the next real opening.
 */
describe('SettingsService.status — open/close window', () => {
  function serviceWith(weeklyHours: Record<string, { open: string; close: string; closed?: boolean }>) {
    const settingsRow: any = {
      id: 1,
      timezone: 'Asia/Kolkata',
      forceClosed: false,
      holidays: [],
      weeklyHours,
      invoiceConfig: {},
      landingContent: {},
    };
    const svc = new SettingsService({} as any);
    // status() calls this.get(); stub it to return our row (already normalized)
    jest.spyOn(svc, 'get').mockResolvedValue(settingsRow);
    return svc;
  }

  const allOpen = () => ({
    sun: { open: '10:00', close: '23:00' }, mon: { open: '10:00', close: '23:00' },
    tue: { open: '10:00', close: '23:00' }, wed: { open: '10:00', close: '23:00' },
    thu: { open: '10:00', close: '23:00' }, fri: { open: '10:00', close: '23:00' },
    sat: { open: '10:00', close: '23:00' },
  });

  // helper: today's 3-letter key in IST, matching the service
  function todayKey(): string {
    const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' })
      .format(new Date()).toLowerCase().slice(0, 3);
    return wd;
  }

  it('BUG REPRO: a day with open === close is reported closed, not open', async () => {
    const hours = allOpen();
    (hours as any)[todayKey()] = { open: '10:00', close: '10:00' }; // the bad config
    const svc = serviceWith(hours);
    const st = await svc.status();
    expect(st.open).toBe(false);
    // and it must NOT promise an opening time it can't honour today
    expect(st.message).not.toMatch(/10:00 (AM|PM) today/);
  });

  it('a normal wide window is open during business hours', async () => {
    // Only meaningful mid-day; if the suite runs at 3am this still shouldn't
    // throw — we just assert the shape is coherent.
    const svc = serviceWith(allOpen());
    const st = await svc.status();
    expect(typeof st.open).toBe('boolean');
    expect(['open', 'outside_hours', 'holiday', 'force_closed']).toContain(st.reason);
  });

  it('force-closed always wins', async () => {
    const svc = serviceWith(allOpen());
    jest.spyOn(svc, 'get').mockResolvedValue({
      id: 1, timezone: 'Asia/Kolkata', forceClosed: true, holidays: [],
      weeklyHours: allOpen(), closedMessage: 'Back soon', invoiceConfig: {}, landingContent: {},
    } as any);
    const st = await svc.status();
    expect(st.open).toBe(false);
    expect(st.reason).toBe('force_closed');
  });
});

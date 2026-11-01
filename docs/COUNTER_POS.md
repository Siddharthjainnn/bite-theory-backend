# Counter POS — Bhawarkua and every other outlet

Walk-in billing at the counter: pick dishes, take payment, one click prints the
kitchen ticket (KOT) and the customer bill. Both show a 3-digit token at the top.

## What is stored

| Table | What |
|---|---|
| `outlets` | Each counter: name, code (bill-number prefix), address / phone / GSTIN / FSSAI printed on the bill, when the business day starts, what the Print button prints |
| `outlet_prices` | Rate list. A row only where an outlet differs from the website price, or hides a dish |
| `pos_bills` | Every bill: outlet, bill no, token, business day, type, payment, totals, GST split, cashier, optional customer |
| `pos_bill_items` | Dishes on each bill, with the price charged at that moment |
| `pos_counters` | Locked counters for the daily token and the yearly bill-number series |

Counter bills are kept apart from `orders`, so they never show up in Live
Orders, rider assignment, customer order history or WhatsApp updates.

## Numbers

- **Token**: 001, 002 … 999, then 001 again. Restarts every business day, per outlet.
- **Bill number**: `BKW/26-27/000001`. One unbroken series per outlet per
  financial year (April–March), 16 characters, which is the GST limit.
- **Business day**: starts at 4 am by default (Admin → Outlets & Rates → Bill
  details). A bill at 1:30 am counts for the previous day.
- Two counters billing at the same second never get the same number.
  A failed bill does not use up a number. A double-click does not make two bills.
- Bills are never deleted. A mistake is **cancelled** with a reason: the number
  stays in the series, the amount drops out of sales, and the report lists it.

## Prices and GST

- The till uses the outlet's rate list. Blank = the website price
  (offer price if lower than MRP).
- GST follows Admin → Store Settings (on/off, rate, prices include GST or not).
  Each bill freezes the rate and the CGST/SGST it charged.
- Totals are rounded to the rupee; the difference prints as "Round off".

## Who can do what

| Role | Counter / POS | Cancel a bill | Outlets & Rates | Counter Reports |
|---|---|---|---|---|
| Cashier (new) | yes | no | no | no |
| Kitchen manager | yes | yes | yes | yes |
| Finance manager | — | yes | yes | yes |
| Super admin | yes | yes | yes | yes |

Create counter staff in **Admin → Admin Users** with the **cashier** role. Their
name prints on every bill they make. Change access in Admin → Roles & Access.

## Setting up the counter PC

1. **Printer**: any 80 mm (or 58 mm) thermal printer installed in Windows. Make it the
   default printer. In its driver settings, set paper cut to **cut after every page**
   (often called "Page [Cut]" or "Cut per page"). Then the KOT and the bill each come
   out cut separately from one click.
2. **Paper size**: Admin → Invoice Layout → Paper → Thermal 80mm (or 58mm).
3. **One click, no print dialog**: make a desktop shortcut with this target:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --user-data-dir="C:\BiteTheoryPOS" --app=https://www.bitestheory.com/admin
   ```

   `--kiosk-printing` sends prints straight to the default printer. The separate
   `--user-data-dir` makes it work even when normal Chrome is already open.
   Sign in once in that window.
4. Open **Counter / POS**, pick the outlet once. The PC remembers it.

## Using the till

- Tap dishes (or type in search and press **Enter** to add the first match; **/** jumps to search).
- Takeaway / Dine in, Cash / UPI / Card. Customer name and mobile are optional.
- Cash: type the amount received to see the change to return.
- **F9** or **Ctrl+Enter** = the big Print button.
- **Today's bills**: search by token, bill number or mobile, reprint the bill or KOT
  (reprints say DUPLICATE), or cancel (managers).

## Reports

Admin → Counter Reports: per outlet or all, any date range — net sales, bills,
average bill, GST (taxable, CGST, SGST, first → last bill number for the
return), payment split, takeaway vs dine-in, sales by hour and by day, best
sellers, categories, cancelled bills with who and why.
Exports: **Bills CSV** (one row per bill) and **Dish-wise CSV**.
**Day close slip** prints the day's totals by payment mode on the thermal printer,
with a line for the cash counted and a signature.

## API

```
GET  /api/pos/outlets                      active outlets
GET  /api/pos/outlets/:id/menu             dishes on sale at that outlet, at its rates
POST /api/pos/bills                        create a bill (token + bill number issued here)
GET  /api/pos/bills?outletId&date&q        one business day's bills
GET  /api/pos/bills/:id                    one bill
POST /api/pos/bills/:id/printed            count a print
POST /api/pos/manage/bills/:id/cancel      cancel with a reason (managers)
GET  /api/pos/reports/summary?from&to&outletId
GET  /api/pos/reports/bills.csv | items.csv
GET  /api/outlets   POST /api/outlets   PATCH /api/outlets/:id
GET  /api/outlets/:id/prices   PUT /api/outlets/:id/prices   POST /api/outlets/:id/prices/copy
```

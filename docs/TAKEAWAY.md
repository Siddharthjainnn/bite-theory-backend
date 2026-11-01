# Online takeaway (order online, collect at an outlet)

At checkout the customer picks **Delivery** or **Takeaway**. For takeaway they
pick the outlet: Vijay Nagar cloud kitchen, Bhawarkua, and any outlet you
switch on later.

## What changes for a takeaway order

| | Delivery | Takeaway |
|---|---|---|
| Address | needed | not asked |
| Delivery fee, rider tip | yes | none |
| Payment | online or cash on delivery | online or **pay at the counter** |
| Kitchen steps | Accept → Food ready → Assign rider → Out for delivery → Delivered | Accept → **Ready for pickup** → **Picked up** |
| Promise shown | delivery time | ready-by time (cooking only, no ride) |
| Code | 4-digit OTP for the rider | same 4 digits as the **pickup code** shown at the counter |

Takeaway orders are never offered to riders, Porter, trips or auto-dispatch,
never get a late make-good credit, and are left out of the delivery report.
They still count in sales, reviews, loyalty and the GST invoice series.

Customers get WhatsApp / app updates: order placed (with pickup code and
outlet), cooking started, **ready for pickup at <outlet>. Show code 1234**,
picked up. No new WhatsApp template is needed: the approved `bt_order_update`
and `bt_order_placed` templates carry the wording.

## Setting it up (Admin → Outlets & Rates → outlet → Bill details & printing → Online takeaway)

- **Customers can order online and collect here**: shows the outlet at checkout.
- **Takeaway starts on**: before this date the outlet shows "Opening 21 Nov"
  and can't be chosen. Bhawarkua is set to 21 Nov 2026 by the migration.
- **Note for customers**: e.g. "Collect at the counter. Show your order code."
- **Google Maps link** (or latitude/longitude): powers the Directions button.
- **Delivery orders are cooked here**: tick for the cloud kitchen. Its Live
  Orders screen then shows deliveries plus its own takeaways.

The migration creates **Vijay Nagar (Cloud Kitchen)** from the kitchen pin and
address in Store Settings (unless an outlet with code VJN or "Vijay" in its
name already exists), with takeaway on and "cooks deliveries" on.

## Live Orders per kitchen

Live Orders has a **This screen** row: All kitchens / Vijay Nagar / Bhawarkua.
Each device remembers its choice, and the new-order pop-up and bell only ring
for that kitchen's orders. Set the Bhawarkua tablet to **Bhawarkua**.

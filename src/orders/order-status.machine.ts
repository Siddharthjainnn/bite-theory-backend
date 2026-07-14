import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Order lifecycle state machine (P0-1).
 *
 * BEFORE: updateStatus() accepted ANY status from ANY status. The killer was
 * `delivered -> cancelled`, which fired refundOnCancel(): a full Razorpay
 * refund + wallet credit + coupon restore, AFTER the food was eaten. Combined
 * with the guessable rider id, that was unlimited free food and a one-script
 * mass-refund of a whole day's revenue.
 *
 * NOW: delivered and cancelled are TERMINAL. Money never moves through the
 * status endpoint after delivery. Post-delivery refunds are a deliberate,
 * admin-only, audited action (POST /orders/:id/refund).
 */

export const TRANSITIONS: Record<string, string[]> = {
  order_received:       ['order_confirmed', 'preparing_food', 'cancelled'],
  order_confirmed:      ['preparing_food', 'cancelled'],
  preparing_food:       ['food_ready', 'cancelled'],
  food_ready:           ['assigned_to_delivery', 'cancelled'],
  assigned_to_delivery: ['out_for_delivery', 'cancelled'],
  out_for_delivery:     ['arriving_soon', 'delivered'],
  arriving_soon:        ['delivered'],
  delivered:            [],   // TERMINAL — no refund path, ever.
  cancelled:            [],   // TERMINAL.
};

/** Statuses a RIDER may set. Note: 'cancelled' is deliberately absent. */
export const RIDER_ALLOWED_STATUSES = [
  'out_for_delivery',
  'arriving_soon',
  'delivered',
];

export function assertTransition(from: string, to: string): void {
  const allowed = TRANSITIONS[from];
  if (!allowed) {
    throw new BadRequestException(`Unknown order status "${from}".`);
  }
  if (from === to) {
    throw new BadRequestException(`Order is already "${from}".`);
  }
  if (!allowed.includes(to)) {
    const why = allowed.length === 0
      ? `"${from}" is a final state and cannot be changed.`
      : `Allowed next: ${allowed.join(', ')}.`;
    throw new BadRequestException(`Cannot move an order from "${from}" to "${to}". ${why}`);
  }
}

export function assertRiderMaySet(status: string): void {
  if (!RIDER_ALLOWED_STATUSES.includes(status)) {
    throw new ForbiddenException(
      `Riders cannot set an order to "${status}". Contact dispatch.`,
    );
  }
}

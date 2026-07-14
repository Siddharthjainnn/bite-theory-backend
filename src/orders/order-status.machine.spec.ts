import { assertTransition, assertRiderMaySet, TRANSITIONS } from './order-status.machine';

describe('order status machine (P0-1 regression)', () => {
  it('BLOCKS the free-food exploit: delivered -> cancelled', () => {
    expect(() => assertTransition('delivered', 'cancelled')).toThrow(/final state/i);
  });

  it('BLOCKS reviving a cancelled order', () => {
    expect(() => assertTransition('cancelled', 'order_confirmed')).toThrow(/final state/i);
  });

  it('BLOCKS skipping straight to delivered', () => {
    expect(() => assertTransition('order_received', 'delivered')).toThrow(/Cannot move/i);
  });

  it('BLOCKS a rider cancelling (and thus refunding) an order', () => {
    expect(() => assertRiderMaySet('cancelled')).toThrow(/Riders cannot/i);
  });

  it('allows the happy path end to end', () => {
    const path = ['order_received', 'order_confirmed', 'preparing_food', 'food_ready',
      'assigned_to_delivery', 'out_for_delivery', 'arriving_soon', 'delivered'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => assertTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it('allows cancel before the food is out for delivery', () => {
    for (const s of ['order_received', 'order_confirmed', 'preparing_food', 'food_ready', 'assigned_to_delivery']) {
      expect(() => assertTransition(s, 'cancelled')).not.toThrow();
    }
  });

  it('lets a rider drive, but only the delivery statuses', () => {
    expect(() => assertRiderMaySet('out_for_delivery')).not.toThrow();
    expect(() => assertRiderMaySet('delivered')).not.toThrow();
    expect(() => assertRiderMaySet('preparing_food')).toThrow();
  });

  it('delivered and cancelled are terminal', () => {
    expect(TRANSITIONS.delivered).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
  });
});

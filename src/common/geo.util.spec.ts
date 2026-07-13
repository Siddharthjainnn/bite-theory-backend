import { haversineKm } from './geo.util';

/**
 * Delivery distance drives the delivery charge and the "outside our zone"
 * rejection, so the geo math is money-adjacent. These pin known distances.
 */
describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(22.7196, 75.8577, 22.7196, 75.8577)).toBeCloseTo(0, 5);
  });

  it('is symmetric', () => {
    const a = haversineKm(22.72, 75.85, 22.75, 75.90);
    const b = haversineKm(22.75, 75.90, 22.72, 75.85);
    expect(a).toBeCloseTo(b, 10);
  });

  it('matches a known city-to-city distance (Indore→Bhopal ≈ 190 km)', () => {
    // Indore 22.7196,75.8577  Bhopal 23.2599,77.4126
    const d = haversineKm(22.7196, 75.8577, 23.2599, 77.4126);
    expect(d).toBeGreaterThan(170);
    expect(d).toBeLessThan(210);
  });

  it('gives a small distance for a ~1km hop', () => {
    // ~0.009 degrees latitude ≈ 1 km
    const d = haversineKm(22.7196, 75.8577, 22.7286, 75.8577);
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.1);
  });
});

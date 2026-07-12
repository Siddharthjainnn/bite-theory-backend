import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Weighted rewards — tune freely. All cashback flows through the wallet. */
const REWARDS: { type: string; value: number; weight: number }[] = [
  { type: 'cashback', value: 5, weight: 40 },
  { type: 'cashback', value: 10, weight: 25 },
  { type: 'cashback', value: 20, weight: 12 },
  { type: 'cashback', value: 50, weight: 3 },
  { type: 'better_luck', value: 0, weight: 20 },
];

@Injectable()
export class ScratchService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  /** Called when an order is delivered. Reward decided HERE, server-side.
      ON CONFLICT keeps it one-card-per-order even if delivery fires twice. */
  async createForOrder(orderId: number, userId: number) {
    const total = REWARDS.reduce((a, r) => a + r.weight, 0);
    let roll = Math.random() * total;
    let pick = REWARDS[REWARDS.length - 1];
    for (const r of REWARDS) { roll -= r.weight; if (roll <= 0) { pick = r; break; } }
    await this.dataSource.query(
      `INSERT INTO scratch_cards (user_id, order_id, reward_type, reward_value)
       VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`,
      [userId, orderId, pick.type, pick.value]);
  }

  /** Card for an order — reward stays hidden until scratched. */
  async forOrder(orderId: number, userId: number) {
    const rows = await this.dataSource.query(
      `SELECT id, user_id AS "userId", order_id AS "orderId", scratched,
              CASE WHEN scratched THEN reward_type ELSE NULL END AS "rewardType",
              CASE WHEN scratched THEN reward_value ELSE NULL END AS "rewardValue"
         FROM scratch_cards WHERE order_id = $1 LIMIT 1`, [orderId]);
    if (!rows.length) return null;
    if (Number(rows[0].userId) !== Number(userId)) throw new ForbiddenException('Not your card');
    return rows[0];
  }

  /** Reveal + pay out, atomically and exactly once. */
  async scratch(id: number, userId: number) {
    return this.dataSource.transaction(async (mgr) => {
      const rows = await mgr.query(
        `SELECT * FROM scratch_cards WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows.length) throw new NotFoundException('Card not found');
      const card = rows[0];
      if (Number(card.user_id) !== Number(userId)) throw new ForbiddenException('Not your card');
      const value = Number(card.reward_value);
      if (!card.scratched) {
        await mgr.query(
          `UPDATE scratch_cards SET scratched = true, scratched_at = now() WHERE id = $1`, [id]);
        if (card.reward_type === 'cashback' && value > 0) {
          await mgr.query(
            `UPDATE users SET wallet_balance = COALESCE(wallet_balance,0) + $1, updated_at = now()
              WHERE id = $2`, [value, userId]);
          await mgr.query(
            `INSERT INTO wallet_transactions (user_id, type, amount, reason, order_id)
             VALUES ($1,'credit',$2,'Scratch card reward 🎉',$3)`,
            [userId, value, card.order_id]);
        }
      }
      return { id: Number(card.id), scratched: true, rewardType: card.reward_type, rewardValue: value };
    });
  }
}

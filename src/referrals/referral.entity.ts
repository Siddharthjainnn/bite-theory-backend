import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'referrals' })
export class Referral {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'referrer_id', nullable: true })
  referrerId: number;

  @Column({ type: 'bigint', name: 'referred_user_id', nullable: true })
  referredUserId: number;

  @Column({ type: 'varchar', name: 'referral_code', nullable: true })
  referralCode: string;

  @Column({ type: 'numeric', name: 'reward_amount', nullable: true })
  rewardAmount: number;

  @Column({ type: 'boolean', name: 'is_converted', nullable: true })
  isConverted: boolean;

  @Column({ type: 'boolean', name: 'rewarded', nullable: true })
  rewarded: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}

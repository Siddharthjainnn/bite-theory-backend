import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', name: 'google_id', nullable: true })
  googleId: string;

  @Column({ type: 'varchar', name: 'email', nullable: true })
  email: string;

  @Column({ type: 'varchar', name: 'first_name', nullable: true })
  firstName: string;

  @Column({ type: 'varchar', name: 'last_name', nullable: true })
  lastName: string;

  @Column({ type: 'varchar', name: 'mobile', nullable: true })
  mobile: string;

  @Column({ type: 'text', name: 'profile_image', nullable: true })
  profileImage: string;

  @Column({ type: 'varchar', name: 'status', nullable: true })
  status: string;

  @Column({ type: 'numeric', name: 'wallet_balance', nullable: true })
  walletBalance: number;

  @Column({ type: 'integer', name: 'loyalty_points', nullable: true })
  loyaltyPoints: number;

  @Column({ type: 'varchar', name: 'loyalty_level', nullable: true })
  loyaltyLevel: string;

  @Column({ type: 'varchar', name: 'referral_code', nullable: true })
  referralCode: string;

  @Column({ type: 'bigint', name: 'referred_by', nullable: true })
  referredBy: number;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', nullable: true })
  updatedAt: Date;

}

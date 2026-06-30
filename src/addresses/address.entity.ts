import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'addresses' })
export class Address {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'user_id', nullable: true })
  userId: number;

  @Column({ type: 'varchar', name: 'label', nullable: true })
  label: string;

  @Column({ type: 'text', name: 'full_address', nullable: true })
  fullAddress: string;

  @Column({ type: 'varchar', name: 'landmark', nullable: true })
  landmark: string;

  @Column({ type: 'varchar', name: 'pincode', nullable: true })
  pincode: string;

  @Column({ type: 'varchar', name: 'city', nullable: true })
  city: string;

  @Column({ type: 'varchar', name: 'state', nullable: true })
  state: string;

  @Column({ type: 'boolean', name: 'is_default', nullable: true })
  isDefault: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}

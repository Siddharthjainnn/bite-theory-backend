import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'user_id', nullable: true })
  userId: number;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId: number;

  @Column({ type: 'varchar', name: 'channel', nullable: true })
  channel: string;

  @Column({ type: 'varchar', name: 'title', nullable: true })
  title: string;

  @Column({ type: 'text', name: 'body', nullable: true })
  body: string;

  @Column({ type: 'boolean', name: 'is_sent', nullable: true })
  isSent: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}

import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'campaigns' })
export class Campaign {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', name: 'name', nullable: true })
  name: string;

  @Column({ type: 'varchar', name: 'channel', nullable: true })
  channel: string;

  @Column({ type: 'text', name: 'message', nullable: true })
  message: string;

  @Column({ type: 'timestamptz', name: 'scheduled_at', nullable: true })
  scheduledAt: Date;

  @Column({ type: 'boolean', name: 'is_sent', nullable: true })
  isSent: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}

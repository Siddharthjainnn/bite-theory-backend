import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'support_tickets' })
export class SupportTicket {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'user_id', nullable: true })
  userId: number;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId: number;

  @Column({ type: 'varchar', name: 'subject', nullable: true })
  subject: string;

  @Column({ type: 'text', name: 'message', nullable: true })
  message: string;

  @Column({ type: 'varchar', name: 'status', nullable: true })
  status: string;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

  @Column({ type: 'text', name: 'attachment', nullable: true })
  attachment: string;
  
  @Column({ type: 'timestamptz', name: 'updated_at', nullable: true })
  updatedAt: Date;

}

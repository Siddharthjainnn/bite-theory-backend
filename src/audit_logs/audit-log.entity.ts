import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'admin_user_id', nullable: true })
  adminUserId: number;

  @Column({ type: 'varchar', name: 'action', nullable: true })
  action: string;

  @Column({ type: 'varchar', name: 'entity', nullable: true })
  entity: string;

  @Column({ type: 'bigint', name: 'entity_id', nullable: true })
  entityId: number;

  @Column({ type: 'jsonb', name: 'details', nullable: true })
  details: any;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}

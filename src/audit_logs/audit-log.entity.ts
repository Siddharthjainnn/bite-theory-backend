import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'admin_user_id', nullable: true })
  adminUserId: number;

  /** Human-readable actor, e.g. "Priya (kitchen_manager)" or "system".
      This column already existed in the DB and was written by raw SQL, but was
      never declared on the entity — so TypeORM queries couldn't see it. */
  @Column({ type: 'varchar', name: 'actor', nullable: true })
  actor: string;

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

import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'admin_users' })
export class AdminUser {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'role_id', nullable: true })
  roleId: number;

  @Column({ type: 'varchar', name: 'name', nullable: true })
  name: string;

  @Column({ type: 'varchar', name: 'email', nullable: true })
  email: string;

  @Column({ type: 'text', name: 'password_hash', nullable: true })
  passwordHash: string;

  @Column({ type: 'boolean', name: 'is_active', nullable: true })
  isActive: boolean;

   @Column({ type: 'text', name: 'avatar', nullable: true })
  avatar: string;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}

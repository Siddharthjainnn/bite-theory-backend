import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'banners' })
export class Banner {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', name: 'title', nullable: true })
  title: string;

  @Column({ type: 'text', name: 'image_url', nullable: true })
  imageUrl: string;

  @Column({ type: 'text', name: 'link_url', nullable: true })
  linkUrl: string;

  @Column({ type: 'varchar', name: 'position', nullable: true })
  position: string;

  @Column({ type: 'integer', name: 'sort_order', nullable: true })
  sortOrder: number;

  @Column({ type: 'boolean', name: 'is_active', nullable: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}

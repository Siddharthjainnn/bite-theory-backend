import {
  Entity, Column, PrimaryGeneratedColumn, OneToMany,
} from 'typeorm';
import { ThaliSection } from './thali-section.entity';

@Entity({ name: 'thali_templates' })
export class ThaliTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', name: 'name' })
  name: string;

  @Column({ type: 'numeric', name: 'base_price' })
  basePrice: number;

  @Column({ type: 'text', name: 'image', nullable: true })
  image: string;

  @Column({ type: 'varchar', name: 'status', default: 'active' })
  status: string;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', nullable: true })
  updatedAt: Date;

  @OneToMany(() => ThaliSection, (s) => s.template, { cascade: false })
  sections: ThaliSection[];
}

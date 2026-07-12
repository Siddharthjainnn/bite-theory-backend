import {
  Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { ThaliSection } from './thali-section.entity';

@Entity({ name: 'thali_options' })
export class ThaliOption {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'section_id' })
  sectionId: number;

  @ManyToOne(() => ThaliSection, (s) => s.options, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section: ThaliSection;

  @Column({ type: 'varchar', name: 'name' })
  name: string;

  @Column({ type: 'numeric', name: 'extra_price', default: 0 })
  extraPrice: number;

  @Column({ type: 'int', name: 'calories', nullable: true })
  calories: number;

  @Column({ type: 'numeric', name: 'protein', nullable: true })
  protein: number;

  @Column({ type: 'text', name: 'image', nullable: true })
  image: string;

  @Column({ type: 'boolean', name: 'is_available', default: true })
  isAvailable: boolean;

  // max portions of this option per thali (admin decides: roti 6, sabzi 2...)
  @Column({ type: 'int', name: 'max_qty', default: 1 })
  maxQty: number;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;
}

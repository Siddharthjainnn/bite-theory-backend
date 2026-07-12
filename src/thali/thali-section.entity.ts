import {
  Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, JoinColumn,
} from 'typeorm';
import { ThaliTemplate } from './thali-template.entity';
import { ThaliOption } from './thali-option.entity';

@Entity({ name: 'thali_sections' })
export class ThaliSection {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'template_id' })
  templateId: number;

  @ManyToOne(() => ThaliTemplate, (t) => t.sections, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id' })
  template: ThaliTemplate;

  @Column({ type: 'varchar', name: 'name' })
  name: string;

  @Column({ type: 'int', name: 'min_select', default: 1 })
  minSelect: number;

  @Column({ type: 'int', name: 'max_select', default: 1 })
  maxSelect: number;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;

  @OneToMany(() => ThaliOption, (o) => o.section, { cascade: false })
  options: ThaliOption[];
}

import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'faq_articles' })
export class FaqArticle {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'category_id' })
  categoryId: number;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text' })
  answer: string;

  /** Optional deep-link that turns an answer into an action, e.g. /orders */
  @Column({ type: 'varchar', name: 'action_label', nullable: true })
  actionLabel: string;

  @Column({ type: 'varchar', name: 'action_url', nullable: true })
  actionUrl: string;

  /** Extra words customers might search for that aren't in the question. */
  @Column({ type: 'text', nullable: true })
  keywords: string;

  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'integer', name: 'view_count', default: 0 })
  viewCount: number;
}

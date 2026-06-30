import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'reviews' })
export class Review {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'user_id', nullable: true })
  userId: number;

  @Column({ type: 'bigint', name: 'product_id', nullable: true })
  productId: number;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId: number;

  @Column({ type: 'integer', name: 'rating', nullable: true })
  rating: number;

  @Column({ type: 'text', name: 'comment', nullable: true })
  comment: string;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;


  @Column({ type: 'text', name: 'image1', nullable: true })
  image1: string;

  @Column({ type: 'text', name: 'image2', nullable: true })
  image2: string;

  @Column({ type: 'text', name: 'image3', nullable: true })
  image3: string;

}

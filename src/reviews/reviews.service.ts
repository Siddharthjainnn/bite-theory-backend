import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './review.entity';
import { CreateReviewDto } from './create-review.dto';
import { UpdateReviewDto } from './update-review.dto';

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(Review)
    private readonly repo: Repository<Review>,
  ) {}

  /**
   * List reviews.
   *  - ?userId=    → "My Reviews" page: joined with product name/image.
   *  - ?productId= → reviews shown on a product page (joined with reviewer name).
   *
   * Bug #40: the admin list showed the raw autoincrement id, which has real gaps
   * (deleted/rolled-back rows) so the numbering looked like it was "skipping".
   * We now order ascending and expose a gap-free "displayId" (1,2,3…) via
   * ROW_NUMBER() for the admin table to render. The real "id" is still returned
   * for edit/delete actions.
   */
  findAll(filters: { userId?: number; productId?: number } = {}) {
    if (filters.userId) {
      return this.repo.query(
        `SELECT ROW_NUMBER() OVER (ORDER BY r.id ASC) AS "displayId",
                r.id, r.product_id AS "productId", r.order_id AS "orderId",
                r.rating, r.comment, r.created_at AS "createdAt",
                r.image1, r.image2, r.image3,
                p.name AS "productName", p.image AS "productImage", p.slug AS "productSlug"
           FROM reviews r
           LEFT JOIN products p ON p.id = r.product_id
          WHERE r.user_id = $1
          ORDER BY r.id ASC`,
        [filters.userId],
      );
    }
    if (filters.productId) {
      return this.repo.query(
        `SELECT ROW_NUMBER() OVER (ORDER BY r.id ASC) AS "displayId",
                r.id, r.rating, r.comment, r.created_at AS "createdAt",
                r.image1, r.image2, r.image3,
                TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS "userName",
                u.profile_image AS "userImage"
           FROM reviews r
           LEFT JOIN users u ON u.id = r.user_id
          WHERE r.product_id = $1
          ORDER BY r.id ASC`,
        [filters.productId],
      );
    }
    return this.repo.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Review not found');
    return item;
  }

  create(dto: CreateReviewDto) {
    const item = this.repo.create(dto as Partial<Review>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateReviewDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<Review>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}

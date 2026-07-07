import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from './favorite.entity';
import { CreateFavoriteDto } from './create-favorite.dto';
import { UpdateFavoriteDto } from './update-favorite.dto';

@Injectable()
export class FavoriteService {
  constructor(
    @InjectRepository(Favorite)
    private readonly repo: Repository<Favorite>,
  ) {}

  /**
   * List favorites. With ?userId= the rows are joined with the product
   * (name, image, price…) so the "Favorites" page can render cards directly.
   */
  findAll(userId?: number) {
    if (!userId) return this.repo.find({ order: { id: 'DESC' } });
    return this.repo.query(
      `SELECT f.id, f.product_id AS "productId", f.created_at AS "createdAt",
              p.name, p.image, p.price, p.offer_price AS "offerPrice",
              p.rating, p.is_veg AS "isVeg", p.status, p.slug
         FROM favorites f
         JOIN products p ON p.id = f.product_id
        WHERE f.user_id = $1
        ORDER BY f.id DESC`,
      [userId],
    );
  }

  /** Just the product ids a user has hearted (cheap; used to paint ❤️ states). */
  async idsForUser(userId: number): Promise<number[]> {
    const rows = await this.repo.query(
      `SELECT product_id FROM favorites WHERE user_id = $1`, [userId]);
    return rows.map((r: any) => Number(r.product_id));
  }

  /** Heart / un-heart in one call. Returns the new state. */
  async toggle(userId: number, productId: number) {
    if (!userId || !productId) throw new BadRequestException('userId and productId required');
    const existing = await this.repo.findOne({ where: { userId, productId } as any });
    if (existing) {
      await this.repo.remove(existing);
      return { favorited: false, productId };
    }
    const item = this.repo.create({ userId, productId } as Partial<Favorite>);
    await this.repo.save(item);
    return { favorited: true, productId };
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Favorite not found');
    return item;
  }

  create(dto: CreateFavoriteDto) {
    const item = this.repo.create(dto as Partial<Favorite>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateFavoriteDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<Favorite>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}

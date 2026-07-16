import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';
import { AuditService } from '../audit_logs/audit.service';
import { CreateProductDto } from './create-product.dto';
import { UpdateProductDto } from './update-product.dto';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly repo: Repository<Product>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Bug #19: an offer must be a deliberate, valid discount. Normalize the
   * offerPrice so the storefront can never show a phantom "% OFF":
   *  - offerPrice <= 0  → treated as "no offer" (null)
   *  - offerPrice >= price → rejected (an offer can't be >= the base price)
   */
  private normalizeOffer(dto: { price?: number; offerPrice?: number | null }, basePrice?: number) {
    const price = dto.price ?? basePrice;
    if (dto.offerPrice != null) {
      if (dto.offerPrice <= 0) {
        dto.offerPrice = null;
      } else if (price != null && dto.offerPrice >= price) {
        throw new BadRequestException('Offer price must be lower than the base price');
      }
    }
  }

  // GET /products — same shape as before, PLUS live stock status so the
  // storefront can show "Sold out" / "Only few left!" instead of items
  // silently vanishing.
  async findAll() {
    const products = await this.repo.find({ order: { id: 'DESC' } });
    const inv = await this.repo.query(
      `SELECT product_id, quantity, stock_status FROM inventory`);
    const by = new Map<number, any>(inv.map((r: any) => [Number(r.product_id), r]));
    return products.map((p) => {
      const row = by.get(Number(p.id));
      return {
        ...p,
        stockStatus: row?.stock_status || 'in_stock',
        stockQty: row ? Number(row.quantity) : null,
      };
    });
  }

  // GET /products/:id
  async findOne(id: number) {
    const product = await this.repo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  // POST /products
  create(dto: CreateProductDto) {
    this.normalizeOffer(dto as any);
    const product = this.repo.create({
      ...dto,
      slug: slugify(dto.name),
    });
    return this.repo.save(product);
  }

  // PATCH /products/:id
  async update(id: number, dto: UpdateProductDto, req?: any) {
    const product = await this.findOne(id);
    this.normalizeOffer(dto as any, Number(product.price));

    /* Audit BEFORE mutating: a price drop from ₹250 to ₹1 is the single most
       damaging edit in this system and it used to leave no trace at all. */
    const before = { ...product };
    Object.assign(product, dto);
    if (dto.name) product.slug = slugify(dto.name);
    const saved = await this.repo.save(product);

    await this.audit.logUpdate('products', id, before, dto as any, req,
      ['name', 'price', 'offerPrice', 'status', 'categoryId', 'isTodaysSpecial', 'isVeg']);
    return saved;
  }

  // DELETE /products/:id
  async remove(id: number, req?: any) {
    const product = await this.findOne(id);
    await this.repo.remove(product);
    await this.audit.log('product.delete', 'products', id,
      { name: product.name, price: product.price }, req);
    return { deleted: true, id };
  }
}

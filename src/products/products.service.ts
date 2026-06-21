import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';
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
  ) {}

  // GET /products
  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  // GET /products/:id
  async findOne(id: number) {
    const product = await this.repo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  // POST /products
  create(dto: CreateProductDto) {
    const product = this.repo.create({
      ...dto,
      slug: slugify(dto.name),
    });
    return this.repo.save(product);
  }

  // PATCH /products/:id
  async update(id: number, dto: UpdateProductDto) {
    const product = await this.findOne(id);
    Object.assign(product, dto);
    if (dto.name) product.slug = slugify(dto.name);
    return this.repo.save(product);
  }

  // DELETE /products/:id
  async remove(id: number) {
    const product = await this.findOne(id);
    await this.repo.remove(product);
    return { deleted: true, id };
  }
}
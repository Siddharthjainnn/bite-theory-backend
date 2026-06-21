import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';
import { CreateCategoryDto } from './create-category.dto';
import { UpdateCategoryDto } from './update-category.dto';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly repo: Repository<Category>,
  ) {}

  // GET /categories  — only active ones, for the menu/dropdown
  findAll() {
    return this.repo.find({ order: { sortOrder: 'ASC' } });
  }

  // GET /categories/:id
  async findOne(id: number) {
    const cat = await this.repo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException(`Category ${id} not found`);
    return cat;
  }

  // POST /categories
  create(dto: CreateCategoryDto) {
    const cat = this.repo.create({
      ...dto,
      slug: slugify(dto.name),
    });
    return this.repo.save(cat);
  }

  // PATCH /categories/:id
  async update(id: number, dto: UpdateCategoryDto) {
    const cat = await this.findOne(id);
    Object.assign(cat, dto);
    if (dto.name) cat.slug = slugify(dto.name);
    return this.repo.save(cat);
  }

  // DELETE /categories/:id
  async remove(id: number) {
    const cat = await this.findOne(id);
    await this.repo.remove(cat);
    return { deleted: true, id };
  }
}
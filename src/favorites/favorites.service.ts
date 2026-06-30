import { Injectable, NotFoundException } from '@nestjs/common';
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

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
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

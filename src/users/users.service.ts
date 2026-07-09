import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  /**
   * Bug #5: was order:{id:'DESC'} → customer list showed newest first, so
   * "customer #1" appeared at the bottom. Ascending gives #1, #2, #3 … at the
   * top as QA expects. (If the admin UI wants newest-first as a *view* option,
   * do that with a client-side sort toggle, not by reversing the canonical
   * id sequence.)
   */
  findAll() {
    return this.repo.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('User not found');
    return item;
  }

  create(dto: CreateUserDto) {
    const item = this.repo.create(dto as Partial<User>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateUserDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<User>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}

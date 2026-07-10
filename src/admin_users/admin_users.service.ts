import {
  Injectable, NotFoundException, UnauthorizedException, BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from './admin-user.entity';
import { CreateAdminUserDto } from './create-admin-user.dto';
import { UpdateAdminUserDto } from './update-admin-user.dto';

@Injectable()
export class AdminUserService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly repo: Repository<AdminUser>,
  ) {}

  findAll() {
    return this.repo.find({
      order: { id: 'DESC' },
      select: { id: true, roleId: true, name: true, email: true, isActive: true, avatar: true, createdAt: true },
    });
  }

  /**
   * Real email + password login. On success, hands back the admin API key
   * the dashboard needs for writes — so the key never ships in the JS bundle.
   */
  async login(email: string, password: string) {
    if (!email?.trim() || !password) throw new BadRequestException('Email and password required');
    const admin = await this.repo
      .createQueryBuilder('a')
      .where('LOWER(a.email) = LOWER(:email)', { email: email.trim() })
      .getOne();
    if (!admin || admin.isActive === false || !admin.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    return {
      ok: true,
      admin: { id: admin.id, name: admin.name, email: admin.email, avatar: admin.avatar },
      adminKey: process.env.ADMIN_API_KEY || '',
    };
  }

  /**
   * One-time bootstrap: create the first admin. Gated by ADMIN_SEED_SECRET
   * env var; refuses if any admin with a password already exists.
   */
  async seed(secret: string, email: string, password: string, name?: string) {
    const expected = process.env.ADMIN_SEED_SECRET;
    if (!expected || secret !== expected) throw new UnauthorizedException('Invalid seed secret');
    const existing = await this.repo
      .createQueryBuilder('a')
      .where('a.password_hash IS NOT NULL')
      .getCount();
    if (existing > 0) throw new BadRequestException('An admin already exists — use login instead');
    if (!email?.trim() || (password || '').length < 8) {
      throw new BadRequestException('Email and a password of at least 8 characters required');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = this.repo.create({
      name: name || 'Admin', email: email.trim(), passwordHash, isActive: true,
    });
    const saved = await this.repo.save(admin);
    return { ok: true, id: saved.id, email: saved.email };
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('AdminUser not found');
    return item;
  }

  async create(dto: CreateAdminUserDto) {
    /* Bug #32: hash a plain password (if given) so the new admin can actually
       log in, and validate the essentials so "create failed" gives a clear
       reason instead of a DB error. */
    if (!dto.email?.trim()) throw new BadRequestException('Email is required');
    const dupe = await this.repo
      .createQueryBuilder('a')
      .where('LOWER(a.email) = LOWER(:email)', { email: dto.email.trim() })
      .getCount();
    if (dupe > 0) throw new BadRequestException('An admin with this email already exists');

    const data: Partial<AdminUser> = {
      roleId: dto.roleId,
      name: dto.name,
      email: dto.email.trim(),
      isActive: dto.isActive ?? true,
      avatar: dto.avatar,
    };
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    } else if (dto.passwordHash) {
      // treat an incoming plain value as a password to hash, not a stored hash
      data.passwordHash = await bcrypt.hash(dto.passwordHash, 10);
    } else {
      throw new BadRequestException('A password of at least 8 characters is required');
    }
    const item = this.repo.create(data);
    const saved = await this.repo.save(item);
    return { id: saved.id, name: saved.name, email: saved.email, roleId: saved.roleId, isActive: saved.isActive };
  }

  async update(id: number, dto: UpdateAdminUserDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<AdminUser>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}

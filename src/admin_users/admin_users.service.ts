import {
  Injectable, NotFoundException, UnauthorizedException, BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from './admin-user.entity';
import { signAdminJwt } from '../common/admin-auth.guard';
import { CreateAdminUserDto } from './create-admin-user.dto';
import { UpdateAdminUserDto } from './update-admin-user.dto';
import { MailService } from '../common/mail.service';

@Injectable()
export class AdminUserService {
  constructor(
    @InjectRepository(AdminUser)
    private readonly repo: Repository<AdminUser>,
    private readonly mail: MailService,
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

    // resolve role name (lower_snake) for role-based checks
    let roleName = '';
    if (admin.roleId) {
      const r = await this.repo.query(
        `SELECT name FROM roles WHERE id = $1 LIMIT 1`, [admin.roleId]);
      roleName = (r?.[0]?.name || '').toString().trim().toLowerCase().replace(/\s+/g, '_');
    }

    // Per-admin JWT (P1). Carries id + role so the backend can enforce
    // role-based access without the shared master key.
    const token = signAdminJwt({
      sub: Number(admin.id),
      name: admin.name,
      email: admin.email,
      role: roleName,
      roleId: admin.roleId ?? null,
    });

    return {
      ok: true,
      admin: {
        id: admin.id, name: admin.name, email: admin.email,
        avatar: admin.avatar, role: roleName, roleId: admin.roleId ?? null,
      },
      token,                                 // ← use this as Authorization: Bearer
      adminKey: process.env.ADMIN_API_KEY || '', // ← kept for backwards compat (break-glass)
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

  /* ── Bug #4: forgot / reset password ─────────────────────────────────
     forgot(): mints a 6-digit code (15-min expiry) and emails it. The reply
     is IDENTICAL whether the email exists or not, so this can't be used to
     probe which addresses have admin accounts.
     reset(): verifies email+code, sets the new bcrypt hash, clears the code. */
  async forgot(email: string) {
    const generic = { ok: true, message: 'If that email has an admin account, a reset code has been sent.' };
    if (!email?.trim()) return generic;
    const admin = await this.repo
      .createQueryBuilder('a')
      .where('LOWER(a.email) = LOWER(:email)', { email: email.trim() })
      .getOne();
    if (!admin || admin.isActive === false) return generic;
    if (!this.mail.isReady) {
      // Be honest with the ONE case where silence would strand the admin:
      // the server simply cannot send email at all.
      throw new BadRequestException(
        'Password reset emails are not configured on this server (SMTP env vars missing). Ask a super admin to reset your password.');
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    admin.resetCode = code;
    admin.resetExpires = new Date(Date.now() + 15 * 60 * 1000);
    await this.repo.save(admin);
    this.mail.send(
      admin.email,
      'Bites Theory admin — password reset code',
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
         <h2 style="color:#0D3B2E">Password reset</h2>
         <p>Use this code to set a new admin password. It expires in 15 minutes.</p>
         <div style="font-size:30px;font-weight:800;letter-spacing:8px;color:#0D3B2E">${code}</div>
         <p style="color:#888;font-size:12px">Didn't request this? You can ignore this email.</p>
       </div>`,
    );
    return generic;
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    if (!email?.trim() || !code?.trim()) throw new BadRequestException('Email and code are required');
    if ((newPassword || '').length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    const admin = await this.repo
      .createQueryBuilder('a')
      .where('LOWER(a.email) = LOWER(:email)', { email: email.trim() })
      .getOne();
    const valid = admin && admin.isActive !== false
      && admin.resetCode && admin.resetCode === code.trim()
      && admin.resetExpires && new Date(admin.resetExpires).getTime() > Date.now();
    if (!valid) throw new BadRequestException('Invalid or expired reset code');
    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    admin.resetCode = null;
    admin.resetExpires = null;
    await this.repo.save(admin);
    return { ok: true, message: 'Password updated — you can sign in now.' };
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
    /* Bug #87 — the generic PATCH forwarded `password` straight into
       repo.update(): it isn't a column, and a raw `passwordHash` string would
       be stored unhashed (locking the admin out). Hash any incoming plain
       password here and strip the non-column key. */
    const { password, passwordHash, ...rest } = dto as any;
    const data: Partial<AdminUser> = { ...rest };
    const plain = password || passwordHash;
    if (plain) {
      if (String(plain).length < 8) {
        throw new BadRequestException('Password must be at least 8 characters');
      }
      data.passwordHash = await bcrypt.hash(String(plain), 10);
    }
    if (Object.keys(data).length) await this.repo.update(id, data);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}

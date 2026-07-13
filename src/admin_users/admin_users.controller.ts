import {
  Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe, Req, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminUserService } from './admin_users.service';
import { CreateAdminUserDto } from './create-admin-user.dto';
import { UpdateAdminUserDto } from './update-admin-user.dto';
import {
  AdminAuthGuard, Roles, AdminJwtPayload,
} from '../common/admin-auth.guard';

/**
 * P1: managing admins (create / update / delete / list) now requires the
 * super_admin role — a Kitchen Manager can't mint new admins. Reads of the
 * admin list also require login. The master key still passes (break-glass).
 *
 * login / seed stay open (login is how you GET a token; seed is secret-gated).
 */
@Controller('admin-users')
export class AdminUserController {
  constructor(private readonly service: AdminUserService) {}

  /** Who am I? Verifies the Bearer token and echoes the admin identity/role.
      The frontend calls this on load to restore a session. */
  @UseGuards(AdminAuthGuard)
  @Get('me')
  me(@Req() req: Request & { admin?: AdminJwtPayload }) {
    const a = req.admin!;
    return { id: a.sub, name: a.name, email: a.email, role: a.role, roleId: a.roleId ?? null };
  }

  @UseGuards(AdminAuthGuard)
  @Roles('super_admin')
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @UseGuards(AdminAuthGuard)
  @Roles('super_admin')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.service.login(body.email, body.password);
  }

  @Post('seed')
  seed(@Body() body: { secret: string; email: string; password: string; name?: string }) {
    return this.service.seed(body.secret, body.email, body.password, body.name);
  }

  @UseGuards(AdminAuthGuard)
  @Roles('super_admin')
  @Post()
  create(@Body() dto: CreateAdminUserDto) {
    return this.service.create(dto);
  }

  @UseGuards(AdminAuthGuard)
  @Roles('super_admin')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAdminUserDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(AdminAuthGuard)
  @Roles('super_admin')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

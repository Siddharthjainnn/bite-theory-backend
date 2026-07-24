import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from './admin-user.entity';
import { AdminUserService } from './admin_users.service';
import { AdminUserController } from './admin_users.controller';
import { MailService } from '../common/mail.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminUser])],
  controllers: [AdminUserController],
  providers: [AdminUserService, MailService],
})
export class AdminUserModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditLogService } from './audit_logs.service';
import { AuditService } from './audit.service';
import { AuditLogController } from './audit_logs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditService],
  exports: [AuditService],
})
export class AuditLogModule {}

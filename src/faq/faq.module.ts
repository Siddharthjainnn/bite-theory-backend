import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FaqCategory } from './faq-category.entity';
import { FaqArticle } from './faq-article.entity';
import { FaqService } from './faq.service';
import { FaqController } from './faq.controller';
import { AuditLogModule } from '../audit_logs/audit_logs.module';

@Module({
  imports: [TypeOrmModule.forFeature([FaqCategory, FaqArticle]), AuditLogModule],
  controllers: [FaqController],
  providers: [FaqService],
})
export class FaqModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThaliTemplate } from './thali-template.entity';
import { ThaliSection } from './thali-section.entity';
import { ThaliOption } from './thali-option.entity';
import { ThaliService } from './thali.service';
import { ThaliController } from './thali.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ThaliTemplate, ThaliSection, ThaliOption])],
  controllers: [ThaliController],
  providers: [ThaliService],
  exports: [ThaliService], // orders module will reuse priceCheck at checkout
})
export class ThaliModule {}

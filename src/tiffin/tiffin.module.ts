import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TiffinLead } from './tiffin-lead.entity';
import { TiffinService } from './tiffin.service';
import { TiffinController } from './tiffin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TiffinLead])],
  controllers: [TiffinController],
  providers: [TiffinService],
})
export class TiffinModule {}

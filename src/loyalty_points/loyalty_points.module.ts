import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoyaltyPoint } from './loyalty-point.entity';
import { LoyaltyPointService } from './loyalty_points.service';
import { LoyaltyPointController } from './loyalty_points.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LoyaltyPoint])],
  controllers: [LoyaltyPointController],
  providers: [LoyaltyPointService],
})
export class LoyaltyPointModule {}

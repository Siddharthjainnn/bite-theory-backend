import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Referral } from './referral.entity';
import { ReferralService } from './referrals.service';
import { ReferralController } from './referrals.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Referral])],
  controllers: [ReferralController],
  providers: [ReferralService],
})
export class ReferralModule {}

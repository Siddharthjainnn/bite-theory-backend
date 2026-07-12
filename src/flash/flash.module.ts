import { Module } from '@nestjs/common';
import { FlashService } from './flash.service';
import { FlashController } from './flash.controller';

@Module({ controllers: [FlashController], providers: [FlashService], exports: [FlashService] })
export class FlashModule {}

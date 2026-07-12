import { Module } from '@nestjs/common';
import { ScratchService } from './scratch.service';
import { ScratchController } from './scratch.controller';

@Module({ controllers: [ScratchController], providers: [ScratchService], exports: [ScratchService] })
export class ScratchModule {}

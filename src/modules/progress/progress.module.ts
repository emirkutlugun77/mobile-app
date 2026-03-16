import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Device,
  UserTopic,
  UserFactHistory,
  UserFavorite,
} from '../../database/entities';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, UserTopic, UserFactHistory, UserFavorite]),
  ],
  controllers: [ProgressController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}

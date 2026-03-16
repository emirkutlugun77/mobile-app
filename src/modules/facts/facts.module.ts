import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Fact,
  UserTopic,
  UserFactHistory,
  UserFavorite,
  Device,
  Topic,
} from '../../database/entities';
import { FactsController, SyncController } from './facts.controller';
import { FactsService } from './facts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Fact,
      UserTopic,
      UserFactHistory,
      UserFavorite,
      Device,
      Topic,
    ]),
  ],
  controllers: [FactsController, SyncController],
  providers: [FactsService],
  exports: [FactsService],
})
export class FactsModule {}

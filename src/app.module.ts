import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Device,
  Topic,
  Fact,
  UserTopic,
  UserFactHistory,
  UserFavorite,
  FactGenerationJob,
} from './database/entities';
import { DeviceModule } from './modules/device/device.module';
import { TopicsModule } from './modules/topics/topics.module';
import { FactsModule } from './modules/facts/facts.module';
import { ProgressModule } from './modules/progress/progress.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get('DATABASE_USERNAME', 'postgres'),
        password: config.get('DATABASE_PASSWORD', 'postgres'),
        database: config.get('DATABASE_NAME', 'intellectual'),
        entities: [
          Device,
          Topic,
          Fact,
          UserTopic,
          UserFactHistory,
          UserFavorite,
          FactGenerationJob,
        ],
        synchronize: true,
        logging: config.get('NODE_ENV') !== 'production',
      }),
    }),
    DeviceModule,
    TopicsModule,
    FactsModule,
    ProgressModule,
  ],
})
export class AppModule {}

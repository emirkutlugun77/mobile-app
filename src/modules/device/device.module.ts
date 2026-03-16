import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../../database/entities';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device])],
  controllers: [DeviceController],
  providers: [DeviceService],
  exports: [DeviceService, TypeOrmModule],
})
export class DeviceModule {}

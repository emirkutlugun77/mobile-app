import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../../database/entities';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

@Injectable()
export class DeviceService {
  constructor(
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
  ) {}

  async register(dto: RegisterDeviceDto) {
    const existing = await this.deviceRepo.findOne({
      where: { device_id: dto.device_id },
    });

    if (existing) {
      await this.deviceRepo.update(existing.id, {
        last_seen_at: new Date(),
        ...(dto.timezone && { timezone: dto.timezone }),
      });
      return {
        device_id: existing.device_id,
        is_new: false,
        streak_count: existing.streak_count,
        total_facts_read: existing.total_facts_read,
        created_at: existing.created_at,
      };
    }

    const device = this.deviceRepo.create({
      device_id: dto.device_id,
      timezone: dto.timezone || 'UTC',
    });
    const saved = await this.deviceRepo.save(device);

    return {
      device_id: saved.device_id,
      is_new: true,
      streak_count: 0,
      total_facts_read: 0,
      created_at: saved.created_at,
    };
  }

  async update(device: Device, dto: UpdateDeviceDto) {
    if (dto.timezone) {
      await this.deviceRepo.update(device.id, { timezone: dto.timezone });
    }
    return { updated: true };
  }

  async findByDeviceId(deviceId: string): Promise<Device | null> {
    return this.deviceRepo.findOne({ where: { device_id: deviceId } });
  }
}

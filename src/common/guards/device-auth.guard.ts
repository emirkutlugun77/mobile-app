import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../../database/entities';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const deviceId = request.headers['x-device-id'];

    if (!deviceId || !UUID_REGEX.test(deviceId)) {
      throw new BadRequestException(
        'Missing or malformed X-Device-ID header',
      );
    }

    const device = await this.deviceRepo.findOne({
      where: { device_id: deviceId },
    });

    if (device) {
      await this.deviceRepo.update(device.id, { last_seen_at: new Date() });
      request.device = device;
    } else {
      request.device = null;
      request.deviceId = deviceId;
    }

    return true;
  }
}

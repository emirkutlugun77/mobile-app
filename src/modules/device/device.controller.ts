import {
  Controller,
  Post,
  Patch,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse } from '@nestjs/swagger';
import { DeviceService } from './device.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { DeviceAuthGuard } from '../../common/guards/device-auth.guard';
import { CurrentDevice } from '../../common/decorators/device.decorator';
import { Device } from '../../database/entities';

@ApiTags('Device')
@Controller('v1/device')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register or re-register a device (upsert)' })
  @ApiResponse({
    status: 200,
    description: 'Device registered successfully',
    schema: {
      example: {
        device_id: 'A3F2B1C4-1234-5678-ABCD-EF0123456789',
        is_new: true,
        streak_count: 0,
        total_facts_read: 0,
        created_at: '2026-03-08T09:00:00Z',
      },
    },
  })
  async register(@Body() dto: RegisterDeviceDto) {
    return this.deviceService.register(dto);
  }

  @Patch()
  @UseGuards(DeviceAuthGuard)
  @ApiOperation({ summary: 'Update device metadata (e.g. timezone)' })
  @ApiSecurity('X-Device-ID')
  @ApiResponse({
    status: 200,
    description: 'Device updated',
    schema: { example: { updated: true } },
  })
  async update(
    @CurrentDevice() device: Device,
    @Body() dto: UpdateDeviceDto,
  ) {
    if (!device) {
      throw new BadRequestException('Device not registered');
    }
    return this.deviceService.update(device, dto);
  }
}

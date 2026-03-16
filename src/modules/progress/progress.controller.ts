import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse } from '@nestjs/swagger';
import { ProgressService } from './progress.service';
import { SessionDto } from './dto/session.dto';
import { DeviceAuthGuard } from '../../common/guards/device-auth.guard';
import { CurrentDevice } from '../../common/decorators/device.decorator';
import { Device } from '../../database/entities';

@ApiTags('Progress')
@ApiSecurity('X-Device-ID')
@Controller('v1/progress')
@UseGuards(DeviceAuthGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get()
  @ApiOperation({ summary: 'Get full progress summary (streak, stats, per-topic)' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        streak_count: 7,
        streak_last_date: '2026-03-08',
        total_facts_read: 312,
        total_favorites: 34,
        topics_following: 6,
        facts_by_topic: [
          {
            topic_id: 'uuid',
            display_name: 'Psychology',
            facts_read: 89,
            facts_favorited: 12,
          },
        ],
        recent_activity: [
          { date: '2026-03-08', facts_read: 12 },
          { date: '2026-03-07', facts_read: 8 },
        ],
      },
    },
  })
  async getProgress(@CurrentDevice() device: Device) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.progressService.getProgress(device);
  }

  @Post('session')
  @ApiOperation({ summary: 'Record a reading session and update streak' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        streak_count: 8,
        streak_extended: true,
        total_facts_read: 317,
      },
    },
  })
  async recordSession(
    @CurrentDevice() device: Device,
    @Body() dto: SessionDto,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.progressService.recordSession(device, dto);
  }
}

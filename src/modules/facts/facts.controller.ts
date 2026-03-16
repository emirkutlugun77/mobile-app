import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { FactsService } from './facts.service';
import { MarkSeenDto } from './dto/mark-seen.dto';
import { SyncEventsDto } from './dto/sync-events.dto';
import { DeviceAuthGuard } from '../../common/guards/device-auth.guard';
import { CurrentDevice } from '../../common/decorators/device.decorator';
import { Device } from '../../database/entities';

@ApiTags('Facts')
@ApiSecurity('X-Device-ID')
@Controller('v1/facts')
@UseGuards(DeviceAuthGuard)
export class FactsController {
  constructor(private readonly factsService: FactsService) {}

  @Get('feed')
  @ApiOperation({ summary: 'Get the daily fact feed (main endpoint)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10, description: 'Max 20' })
  @ApiQuery({ name: 'topic_id', required: false, type: String, description: 'Filter by topic UUID' })
  @ApiQuery({ name: 'mode', required: false, enum: ['random'], description: 'Shuffle mode' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        facts: [
          {
            id: 'uuid',
            topic_id: 'uuid',
            topic_slug: 'ww2-tanks',
            topic_display_name: 'WW2 Tanks',
            lines: [
              'the tiger i tank was feared across every front.',
              'but germany produced fewer than 1,350 total.',
              'the soviet t-34 outnumbered it roughly 10 to 1.',
            ],
            is_favorited: false,
          },
        ],
        exhausted_topics: ['uuid'],
        prefetch_triggered: ['uuid'],
        has_more: true,
      },
    },
  })
  async getFeed(
    @CurrentDevice() device: Device,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('topic_id') topicId?: string,
    @Query('mode') mode?: string,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.factsService.getFeed(device, limit, topicId, mode);
  }

  @Get('topic/:topicId')
  @ApiOperation({ summary: 'Get unseen facts for a specific topic' })
  @ApiParam({ name: 'topicId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  async getTopicFacts(
    @CurrentDevice() device: Device,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.factsService.getFactsForTopic(device, topicId, limit, offset);
  }

  @Post(':factId/seen')
  @ApiOperation({ summary: 'Mark a fact as seen' })
  @ApiParam({ name: 'factId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: {
      example: { fact_id: 'uuid', recorded: true, total_facts_read: 142 },
    },
  })
  async markSeen(
    @CurrentDevice() device: Device,
    @Param('factId', ParseUUIDPipe) factId: string,
    @Body() dto: MarkSeenDto,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.factsService.markSeen(device, factId, dto.read_fully);
  }

  @Post(':factId/favorite')
  @ApiOperation({ summary: 'Toggle favorite on a fact' })
  @ApiParam({ name: 'factId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: {
      example: { fact_id: 'uuid', is_favorited: true },
    },
  })
  async toggleFavorite(
    @CurrentDevice() device: Device,
    @Param('factId', ParseUUIDPipe) factId: string,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.factsService.toggleFavorite(device, factId);
  }

  @Get('favorites')
  @ApiOperation({ summary: 'List all favorited facts' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        favorites: [
          {
            id: 'uuid',
            topic_display_name: 'Psychology',
            lines: ['line 1.', 'line 2.'],
            favorited_at: '2026-03-07T18:30:00Z',
          },
        ],
        total: 34,
      },
    },
  })
  async getFavorites(
    @CurrentDevice() device: Device,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.factsService.getFavorites(device, limit, offset);
  }

  @Get('history')
  @ApiOperation({ summary: 'Full fact reading history' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiQuery({ name: 'topic_id', required: false, type: String, description: 'Filter by topic UUID' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        history: [
          {
            id: 'uuid',
            topic_display_name: 'History',
            lines: ['line 1.', 'line 2.'],
            seen_at: '2026-03-08T08:45:00Z',
            read_fully: true,
            is_favorited: false,
          },
        ],
        total: 312,
      },
    },
  })
  async getHistory(
    @CurrentDevice() device: Device,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('topic_id') topicId?: string,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.factsService.getHistory(device, limit, offset, topicId);
  }
}

@ApiTags('Sync')
@ApiSecurity('X-Device-ID')
@Controller('v1/sync')
@UseGuards(DeviceAuthGuard)
export class SyncController {
  constructor(private readonly factsService: FactsService) {}

  @Post('events')
  @ApiOperation({ summary: 'Batch sync offline events (seen/favorite)' })
  @ApiResponse({
    status: 200,
    schema: {
      example: { processed: 5, total: 5 },
    },
  })
  async syncEvents(
    @CurrentDevice() device: Device,
    @Body() dto: SyncEventsDto,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.factsService.syncEvents(device, dto.events);
  }
}

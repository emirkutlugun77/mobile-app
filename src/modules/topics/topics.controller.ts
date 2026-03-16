import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { TopicsService } from './topics.service';
import { CreateCustomTopicDto } from './dto/create-custom-topic.dto';
import { DeviceAuthGuard } from '../../common/guards/device-auth.guard';
import { CurrentDevice } from '../../common/decorators/device.decorator';
import { Device } from '../../database/entities';

@ApiTags('Topics')
@ApiSecurity('X-Device-ID')
@Controller('v1/topics')
@UseGuards(DeviceAuthGuard)
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get('preset')
  @ApiOperation({ summary: 'List all preset topics' })
  @ApiQuery({ name: 'category', required: false, example: 'science' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        topics: [
          {
            id: 'uuid',
            slug: 'history',
            display_name: 'History',
            description: 'Major events and turning points in human history.',
            category: 'humanities',
            tags: ['history', 'culture', 'events'],
            fact_count: 247,
            is_following: false,
          },
        ],
      },
    },
  })
  async getPresetTopics(
    @CurrentDevice() device: Device,
    @Query('category') category?: string,
  ) {
    return this.topicsService.getPresetTopics(device, category);
  }

  @Post('custom')
  @ApiOperation({ summary: 'Create a custom topic (triggers AI generation)' })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        id: 'uuid',
        slug: 'ww2-tanks',
        display_name: 'WW2 Tanks',
        category: 'uncategorized',
        tags: [],
        status: 'generating',
        estimated_ready_seconds: 30,
      },
    },
  })
  async createCustomTopic(
    @CurrentDevice() device: Device,
    @Body() dto: CreateCustomTopicDto,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.topicsService.createCustomTopic(device, dto);
  }

  @Get('custom/:topicId/status')
  @ApiOperation({ summary: 'Poll generation status of a custom topic' })
  @ApiParam({ name: 'topicId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        topic_id: 'uuid',
        status: 'done',
        fact_count: 10,
      },
    },
  })
  async getCustomTopicStatus(
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    return this.topicsService.getCustomTopicStatus(topicId);
  }

  @Post(':topicId/follow')
  @ApiOperation({ summary: 'Follow a topic' })
  @ApiParam({ name: 'topicId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: {
      example: { topic_id: 'uuid', followed: true, unseen_fact_count: 10 },
    },
  })
  async followTopic(
    @CurrentDevice() device: Device,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.topicsService.followTopic(device, topicId);
  }

  @Delete(':topicId/follow')
  @ApiOperation({ summary: 'Unfollow a topic (history & favorites preserved)' })
  @ApiParam({ name: 'topicId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: {
      example: { topic_id: 'uuid', followed: false },
    },
  })
  async unfollowTopic(
    @CurrentDevice() device: Device,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.topicsService.unfollowTopic(device, topicId);
  }

  @Get('following')
  @ApiOperation({ summary: 'List all topics the device follows with progress' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        topics: [
          {
            id: 'uuid',
            slug: 'ww2-tanks',
            display_name: 'WW2 Tanks',
            category: 'history',
            tags: ['military', 'history'],
            is_preset: false,
            fact_count: 47,
            unseen_fact_count: 12,
            last_fact_served_at: '2026-03-07T20:14:00Z',
          },
        ],
      },
    },
  })
  async getFollowingTopics(@CurrentDevice() device: Device) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.topicsService.getFollowingTopics(device);
  }

  @Get('recommended')
  @ApiOperation({ summary: 'Get recommended topics based on followed topics' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        recommendations: [
          {
            id: 'uuid',
            slug: 'swift-programming',
            display_name: 'Swift Programming',
            category: 'technology',
            tags: ['programming', 'ios'],
            reason: 'Because you follow iOS Development',
            fact_count: 95,
            is_preset: true,
          },
        ],
      },
    },
  })
  async getRecommendedTopics(@CurrentDevice() device: Device) {
    if (!device) throw new BadRequestException('Device not registered');
    return this.topicsService.getRecommendedTopics(device);
  }
}

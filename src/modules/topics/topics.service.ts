import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Topic,
  UserTopic,
  Fact,
  Device,
} from '../../database/entities';
import { CreateCustomTopicDto } from './dto/create-custom-topic.dto';

@Injectable()
export class TopicsService {
  constructor(
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
    @InjectRepository(UserTopic)
    private readonly userTopicRepo: Repository<UserTopic>,
    @InjectRepository(Fact)
    private readonly factRepo: Repository<Fact>,
  ) {}

  async getPresetTopics(device: Device | null, category?: string) {
    const qb = this.topicRepo
      .createQueryBuilder('t')
      .where('t.is_preset = TRUE')
      .andWhere('t.is_active = TRUE');

    if (category) {
      qb.andWhere('t.category = :category', { category });
    }

    qb.orderBy('t.display_name', 'ASC');

    const topics = await qb.getMany();

    let followedTopicIds = new Set<string>();
    if (device) {
      const followed = await this.userTopicRepo.find({
        where: { device_id: device.id, is_active: true },
        select: ['topic_id'],
      });
      followedTopicIds = new Set(followed.map((f) => f.topic_id));
    }

    return {
      topics: topics.map((t) => ({
        id: t.id,
        slug: t.slug,
        display_name: t.display_name,
        description: t.description,
        category: t.category,
        tags: t.tags,
        fact_count: t.fact_count,
        is_following: followedTopicIds.has(t.id),
      })),
    };
  }

  async createCustomTopic(device: Device, dto: CreateCustomTopicDto) {
    const slug = dto.display_name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();

    const topic = this.topicRepo.create({
      slug: `${slug}-${Date.now()}`,
      display_name: dto.display_name,
      description: dto.description || undefined,
      is_preset: false,
      category: 'uncategorized',
      tags: [],
      created_by: device.id,
    });

    const saved = await this.topicRepo.save(topic);

    return {
      id: saved.id,
      slug: saved.slug,
      display_name: saved.display_name,
      category: saved.category,
      tags: saved.tags,
      status: 'generating',
      estimated_ready_seconds: 30,
    };
  }

  async getCustomTopicStatus(topicId: string) {
    const topic = await this.topicRepo.findOne({ where: { id: topicId } });
    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    const status = topic.fact_count > 0 ? 'done' : 'generating';

    return {
      topic_id: topic.id,
      status,
      fact_count: topic.fact_count,
    };
  }

  async followTopic(device: Device, topicId: string) {
    const topic = await this.topicRepo.findOne({
      where: { id: topicId, is_active: true },
    });
    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    const existing = await this.userTopicRepo.findOne({
      where: { device_id: device.id, topic_id: topicId },
    });

    if (existing) {
      if (!existing.is_active) {
        await this.userTopicRepo.update(existing.id, { is_active: true });
      }
    } else {
      const unseenCount = await this.factRepo.count({
        where: { topic_id: topicId, is_active: true },
      });

      const userTopic = this.userTopicRepo.create({
        device_id: device.id,
        topic_id: topicId,
        unseen_fact_count: unseenCount,
      });
      await this.userTopicRepo.save(userTopic);
    }

    const ut = await this.userTopicRepo.findOne({
      where: { device_id: device.id, topic_id: topicId },
    });

    return {
      topic_id: topicId,
      followed: true,
      unseen_fact_count: ut?.unseen_fact_count ?? 0,
    };
  }

  async unfollowTopic(device: Device, topicId: string) {
    const existing = await this.userTopicRepo.findOne({
      where: { device_id: device.id, topic_id: topicId },
    });

    if (existing) {
      await this.userTopicRepo.update(existing.id, { is_active: false });
    }

    return {
      topic_id: topicId,
      followed: false,
    };
  }

  async getFollowingTopics(device: Device) {
    const userTopics = await this.userTopicRepo.find({
      where: { device_id: device.id, is_active: true },
      relations: ['topic'],
    });

    return {
      topics: userTopics.map((ut) => ({
        id: ut.topic.id,
        slug: ut.topic.slug,
        display_name: ut.topic.display_name,
        category: ut.topic.category,
        tags: ut.topic.tags,
        is_preset: ut.topic.is_preset,
        fact_count: ut.topic.fact_count,
        unseen_fact_count: ut.unseen_fact_count,
        last_fact_served_at: ut.last_fact_served_at,
      })),
    };
  }

  async getRecommendedTopics(device: Device) {
    const followed = await this.userTopicRepo.find({
      where: { device_id: device.id, is_active: true },
      relations: ['topic'],
    });

    if (followed.length === 0) {
      const popular = await this.topicRepo.find({
        where: { is_preset: true, is_active: true },
        order: { fact_count: 'DESC' },
        take: 10,
      });
      return {
        recommendations: popular.map((t) => ({
          id: t.id,
          slug: t.slug,
          display_name: t.display_name,
          category: t.category,
          tags: t.tags,
          reason: `Popular in ${t.category}`,
          fact_count: t.fact_count,
          is_preset: t.is_preset,
        })),
      };
    }

    const followedIds = followed.map((f) => f.topic_id);
    const followedCategories = [
      ...new Set(followed.map((f) => f.topic.category)),
    ];
    const followedTags = [
      ...new Set(followed.flatMap((f) => f.topic.tags)),
    ];

    const qb = this.topicRepo
      .createQueryBuilder('t')
      .where('t.is_active = TRUE')
      .andWhere('t.id NOT IN (:...followedIds)', { followedIds })
      .andWhere('t.fact_count >= 10');

    const candidates = await qb.getMany();

    const scored = candidates
      .map((t) => {
        let score = 0;
        if (followedCategories.includes(t.category)) score += 3;
        score += t.tags.filter((tag) => followedTags.includes(tag)).length;
        return { topic: t, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.topic.fact_count - a.topic.fact_count)
      .slice(0, 10);

    return {
      recommendations: scored.map((s) => {
        const match = followed.find(
          (f) => f.topic.category === s.topic.category,
        );
        const reason = match
          ? `Because you follow ${match.topic.display_name}`
          : `Popular in ${s.topic.category}`;

        return {
          id: s.topic.id,
          slug: s.topic.slug,
          display_name: s.topic.display_name,
          category: s.topic.category,
          tags: s.topic.tags,
          reason,
          fact_count: s.topic.fact_count,
          is_preset: s.topic.is_preset,
        };
      }),
    };
  }
}

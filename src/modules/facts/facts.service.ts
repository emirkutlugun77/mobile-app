import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  Fact,
  UserTopic,
  UserFactHistory,
  UserFavorite,
  Device,
  Topic,
} from '../../database/entities';

interface UserTopicWithMeta {
  topic_id: string;
  last_fact_served_at: Date | null;
  unseen_fact_count: number;
}

@Injectable()
export class FactsService {
  constructor(
    @InjectRepository(Fact)
    private readonly factRepo: Repository<Fact>,
    @InjectRepository(UserTopic)
    private readonly userTopicRepo: Repository<UserTopic>,
    @InjectRepository(UserFactHistory)
    private readonly historyRepo: Repository<UserFactHistory>,
    @InjectRepository(UserFavorite)
    private readonly favoriteRepo: Repository<UserFavorite>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
    private readonly dataSource: DataSource,
  ) {}

  async getFeed(
    device: Device,
    limit = 10,
    topicId?: string,
    mode?: string,
  ) {
    limit = Math.min(limit, 20);

    if (topicId) {
      return this.getFactsForTopic(device, topicId, limit);
    }

    const userTopics = await this.userTopicRepo.find({
      where: { device_id: device.id, is_active: true },
    });

    if (userTopics.length === 0) {
      return { facts: [], has_more: false };
    }

    const allocations =
      mode === 'random'
        ? this.allocateSlotsRandom(userTopics, limit)
        : this.allocateSlots(userTopics, limit);

    const allFacts: any[] = [];
    const exhaustedTopics: string[] = [];
    const prefetchTriggered: string[] = [];

    for (const [topicId, slots] of allocations) {
      const facts = await this.fetchUnseenFacts(device.id, topicId, slots, mode === 'random');

      if (facts.length === 0) {
        exhaustedTopics.push(topicId);
      }

      if (facts.length > 0) {
        await this.userTopicRepo.update(
          { device_id: device.id, topic_id: topicId },
          { last_fact_served_at: new Date() },
        );
      }

      const ut = userTopics.find((u) => u.topic_id === topicId);
      if (ut && ut.unseen_fact_count <= 3) {
        prefetchTriggered.push(topicId);
      }

      allFacts.push(...facts);
    }

    const interleaved = this.interleaveFacts(allFacts, allocations);

    const favoriteIds = await this.getFavoriteFactIds(device.id);

    return {
      facts: interleaved.map((f) => ({
        id: f.id,
        topic_id: f.topic_id,
        topic_slug: f.topic_slug,
        topic_display_name: f.topic_display_name,
        lines: f.lines,
        is_favorited: favoriteIds.has(f.id),
      })),
      exhausted_topics: exhaustedTopics.length > 0 ? exhaustedTopics : undefined,
      prefetch_triggered: prefetchTriggered.length > 0 ? prefetchTriggered : undefined,
      has_more: allFacts.length >= limit,
    };
  }

  async getFactsForTopic(
    device: Device,
    topicId: string,
    limit = 10,
    offset = 0,
  ) {
    const topic = await this.topicRepo.findOne({ where: { id: topicId } });
    if (!topic) throw new NotFoundException('Topic not found');

    const facts = await this.dataSource.query(
      `SELECT f.id, f.topic_id, f.lines, f.content
       FROM facts f
       LEFT JOIN user_fact_history h
         ON h.fact_id = f.id AND h.device_id = $1
       WHERE f.topic_id = $2
         AND f.is_active = TRUE
         AND h.fact_id IS NULL
       ORDER BY f.created_at ASC
       LIMIT $3 OFFSET $4`,
      [device.id, topicId, limit, offset],
    );

    const favoriteIds = await this.getFavoriteFactIds(device.id);

    return {
      facts: facts.map((f: any) => ({
        id: f.id,
        topic_id: f.topic_id,
        topic_slug: topic.slug,
        topic_display_name: topic.display_name,
        lines: f.lines,
        is_favorited: favoriteIds.has(f.id),
      })),
      has_more: facts.length >= limit,
    };
  }

  async markSeen(device: Device, factId: string, readFully = false) {
    const fact = await this.factRepo.findOne({ where: { id: factId } });
    if (!fact) throw new NotFoundException('Fact not found');

    const existing = await this.historyRepo.findOne({
      where: { device_id: device.id, fact_id: factId },
    });

    if (existing) {
      if (readFully && !existing.read_fully) {
        await this.historyRepo.update(existing.id, { read_fully: true });
      }
    } else {
      const history = this.historyRepo.create({
        device_id: device.id,
        fact_id: factId,
        topic_id: fact.topic_id,
        read_fully: readFully,
      });
      await this.historyRepo.save(history);

      await this.userTopicRepo
        .createQueryBuilder()
        .update()
        .set({ unseen_fact_count: () => 'GREATEST(unseen_fact_count - 1, 0)' })
        .where('device_id = :deviceId AND topic_id = :topicId', {
          deviceId: device.id,
          topicId: fact.topic_id,
        })
        .execute();
    }

    if (readFully) {
      await this.deviceRepo.increment(
        { id: device.id },
        'total_facts_read',
        1,
      );
    }

    const updatedDevice = await this.deviceRepo.findOne({
      where: { id: device.id },
    });

    return {
      fact_id: factId,
      recorded: true,
      total_facts_read: updatedDevice?.total_facts_read ?? 0,
    };
  }

  async toggleFavorite(device: Device, factId: string) {
    const fact = await this.factRepo.findOne({ where: { id: factId } });
    if (!fact) throw new NotFoundException('Fact not found');

    const existing = await this.favoriteRepo.findOne({
      where: { device_id: device.id, fact_id: factId },
    });

    if (existing) {
      await this.favoriteRepo.remove(existing);
      return { fact_id: factId, is_favorited: false };
    }

    const favorite = this.favoriteRepo.create({
      device_id: device.id,
      fact_id: factId,
    });
    await this.favoriteRepo.save(favorite);
    return { fact_id: factId, is_favorited: true };
  }

  async getFavorites(device: Device, limit = 20, offset = 0) {
    const [favorites, total] = await this.favoriteRepo.findAndCount({
      where: { device_id: device.id },
      relations: ['fact', 'fact.topic'],
      order: { favorited_at: 'DESC' },
      take: limit,
      skip: offset,
    });

    return {
      favorites: favorites.map((f) => ({
        id: f.fact.id,
        topic_display_name: f.fact.topic?.display_name ?? '',
        lines: f.fact.lines,
        favorited_at: f.favorited_at,
      })),
      total,
    };
  }

  async getHistory(
    device: Device,
    limit = 20,
    offset = 0,
    topicId?: string,
  ) {
    const qb = this.historyRepo
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.fact', 'f')
      .leftJoinAndSelect('f.topic', 't')
      .where('h.device_id = :deviceId', { deviceId: device.id })
      .orderBy('h.seen_at', 'DESC')
      .take(limit)
      .skip(offset);

    if (topicId) {
      qb.andWhere('h.topic_id = :topicId', { topicId });
    }

    const [history, total] = await qb.getManyAndCount();

    const favoriteIds = await this.getFavoriteFactIds(device.id);

    return {
      history: history.map((h) => ({
        id: h.fact.id,
        topic_display_name: h.fact.topic?.display_name ?? '',
        lines: h.fact.lines,
        seen_at: h.seen_at,
        read_fully: h.read_fully,
        is_favorited: favoriteIds.has(h.fact_id),
      })),
      total,
    };
  }

  // --- Private helpers ---

  private allocateSlots(
    userTopics: UserTopicWithMeta[],
    limit: number,
  ): Map<string, number> {
    const now = Date.now();
    const allocations = new Map<string, number>();
    let remaining = limit;

    const sorted = [...userTopics].sort((a, b) => {
      const aTime = a.last_fact_served_at
        ? new Date(a.last_fact_served_at).getTime()
        : 0;
      const bTime = b.last_fact_served_at
        ? new Date(b.last_fact_served_at).getTime()
        : 0;
      return aTime - bTime;
    });

    for (const topic of sorted) {
      if (remaining <= 0) break;

      const lastServed = topic.last_fact_served_at
        ? now - new Date(topic.last_fact_served_at).getTime()
        : Infinity;

      let slots: number;
      if (!topic.last_fact_served_at) {
        slots = 3;
      } else if (lastServed > 24 * 3600 * 1000) {
        slots = 2;
      } else {
        slots = 1;
      }

      slots = Math.min(slots, 5, remaining, topic.unseen_fact_count);
      if (slots > 0) {
        allocations.set(topic.topic_id, slots);
        remaining -= slots;
      }
    }

    return allocations;
  }

  private allocateSlotsRandom(
    userTopics: UserTopicWithMeta[],
    limit: number,
  ): Map<string, number> {
    const allocations = new Map<string, number>();
    let remaining = limit;

    const shuffled = [...userTopics].sort(() => Math.random() - 0.5);

    for (const topic of shuffled) {
      if (remaining <= 0) break;
      const slots = Math.min(
        Math.ceil(limit / userTopics.length),
        5,
        remaining,
        topic.unseen_fact_count,
      );
      if (slots > 0) {
        allocations.set(topic.topic_id, slots);
        remaining -= slots;
      }
    }

    return allocations;
  }

  private async fetchUnseenFacts(
    deviceInternalId: string,
    topicId: string,
    limit: number,
    random = false,
  ): Promise<any[]> {
    const orderClause = random
      ? 'ORDER BY RANDOM()'
      : 'ORDER BY f.created_at ASC';

    const rows = await this.dataSource.query(
      `SELECT f.id, f.topic_id, f.lines, f.content, t.slug AS topic_slug, t.display_name AS topic_display_name
       FROM facts f
       JOIN topics t ON t.id = f.topic_id
       LEFT JOIN user_fact_history h
         ON h.fact_id = f.id AND h.device_id = $1
       WHERE f.topic_id = $2
         AND f.is_active = TRUE
         AND h.fact_id IS NULL
       ${orderClause}
       LIMIT $3`,
      [deviceInternalId, topicId, limit],
    );

    return rows;
  }

  private interleaveFacts(
    allFacts: any[],
    allocations: Map<string, number>,
  ): any[] {
    const byTopic = new Map<string, any[]>();
    for (const fact of allFacts) {
      const existing = byTopic.get(fact.topic_id) || [];
      existing.push(fact);
      byTopic.set(fact.topic_id, existing);
    }

    const result: any[] = [];
    const topicIds = [...allocations.keys()];
    let idx = 0;

    while (result.length < allFacts.length) {
      let added = false;
      for (let i = 0; i < topicIds.length; i++) {
        const tid = topicIds[(idx + i) % topicIds.length];
        const bucket = byTopic.get(tid);
        if (bucket && bucket.length > 0) {
          result.push(bucket.shift()!);
          added = true;
          break;
        }
      }
      if (!added) break;
      idx++;
    }

    return result;
  }

  async syncEvents(
    device: Device,
    events: Array<{
      type: 'seen' | 'favorite';
      fact_id: string;
      read_fully?: boolean;
      occurred_at: string;
    }>,
  ) {
    let processed = 0;
    for (const event of events) {
      try {
        if (event.type === 'seen') {
          await this.markSeen(device, event.fact_id, event.read_fully);
        } else if (event.type === 'favorite') {
          await this.toggleFavorite(device, event.fact_id);
        }
        processed++;
      } catch {
        // skip invalid events (e.g. already deleted facts)
      }
    }
    return { processed, total: events.length };
  }

  private async getFavoriteFactIds(
    deviceInternalId: string,
  ): Promise<Set<string>> {
    const favs = await this.favoriteRepo.find({
      where: { device_id: deviceInternalId },
      select: ['fact_id'],
    });
    return new Set(favs.map((f) => f.fact_id));
  }
}

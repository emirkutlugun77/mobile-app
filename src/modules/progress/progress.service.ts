import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { subDays, parseISO, format } from 'date-fns';
import {
  Device,
  UserTopic,
  UserFactHistory,
  UserFavorite,
} from '../../database/entities';
import { SessionDto } from './dto/session.dto';

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(UserTopic)
    private readonly userTopicRepo: Repository<UserTopic>,
    @InjectRepository(UserFactHistory)
    private readonly historyRepo: Repository<UserFactHistory>,
    @InjectRepository(UserFavorite)
    private readonly favoriteRepo: Repository<UserFavorite>,
    private readonly dataSource: DataSource,
  ) {}

  async getProgress(device: Device) {
    const totalFavorites = await this.favoriteRepo.count({
      where: { device_id: device.id },
    });

    const topicsFollowing = await this.userTopicRepo.count({
      where: { device_id: device.id, is_active: true },
    });

    const factsByTopic = await this.dataSource.query(
      `SELECT
         t.id AS topic_id,
         t.display_name,
         COUNT(h.id) FILTER (WHERE h.read_fully = TRUE) AS facts_read,
         COUNT(uf.id) AS facts_favorited
       FROM user_topics ut
       JOIN topics t ON t.id = ut.topic_id
       LEFT JOIN user_fact_history h
         ON h.device_id = ut.device_id AND h.topic_id = ut.topic_id
       LEFT JOIN user_favorites uf
         ON uf.device_id = ut.device_id AND uf.fact_id = h.fact_id
       WHERE ut.device_id = $1 AND ut.is_active = TRUE
       GROUP BY t.id, t.display_name
       ORDER BY facts_read DESC`,
      [device.id],
    );

    const recentActivity = await this.dataSource.query(
      `SELECT
         DATE(h.seen_at AT TIME ZONE $2) AS date,
         COUNT(*) FILTER (WHERE h.read_fully = TRUE) AS facts_read
       FROM user_fact_history h
       WHERE h.device_id = $1
         AND h.seen_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(h.seen_at AT TIME ZONE $2)
       ORDER BY date DESC`,
      [device.id, device.timezone],
    );

    return {
      streak_count: device.streak_count,
      streak_last_date: device.streak_last_date,
      total_facts_read: device.total_facts_read,
      total_favorites: totalFavorites,
      topics_following: topicsFollowing,
      facts_by_topic: factsByTopic.map((r: any) => ({
        topic_id: r.topic_id,
        display_name: r.display_name,
        facts_read: parseInt(r.facts_read, 10) || 0,
        facts_favorited: parseInt(r.facts_favorited, 10) || 0,
      })),
      recent_activity: recentActivity.map((r: any) => ({
        date: r.date,
        facts_read: parseInt(r.facts_read, 10) || 0,
      })),
    };
  }

  async recordSession(device: Device, dto: SessionDto) {
    if (dto.timezone) {
      await this.deviceRepo.update(device.id, { timezone: dto.timezone });
    }

    const newStreak = await this.updateStreak(device, dto.session_date);

    const updatedDevice = await this.deviceRepo.findOne({
      where: { id: device.id },
    });

    return {
      streak_count: newStreak,
      streak_extended: newStreak > device.streak_count,
      total_facts_read: updatedDevice?.total_facts_read ?? device.total_facts_read,
    };
  }

  private async updateStreak(
    device: Device,
    sessionDate: string,
  ): Promise<number> {
    const lastDate = device.streak_last_date;

    if (lastDate === sessionDate) {
      return device.streak_count;
    }

    const yesterday = format(subDays(parseISO(sessionDate), 1), 'yyyy-MM-dd');

    let newStreak: number;
    if (lastDate === yesterday) {
      newStreak = device.streak_count + 1;
    } else {
      newStreak = 1;
    }

    await this.deviceRepo.update(device.id, {
      streak_count: newStreak,
      streak_last_date: sessionDate,
    });

    return newStreak;
  }
}

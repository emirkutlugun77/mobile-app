import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { UserTopic } from './user-topic.entity';
import { UserFactHistory } from './user-fact-history.entity';
import { UserFavorite } from './user-favorite.entity';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_devices_device_id', { unique: true })
  @Column({ type: 'text', unique: true })
  device_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_seen_at: Date;

  @Column({ type: 'text', default: 'UTC' })
  timezone: string;

  @Column({ type: 'int', default: 0 })
  streak_count: number;

  @Column({ type: 'date', nullable: true })
  streak_last_date: string | null;

  @Column({ type: 'int', default: 0 })
  total_facts_read: number;

  @OneToMany(() => UserTopic, (ut) => ut.device)
  user_topics: UserTopic[];

  @OneToMany(() => UserFactHistory, (h) => h.device)
  fact_history: UserFactHistory[];

  @OneToMany(() => UserFavorite, (f) => f.device)
  favorites: UserFavorite[];
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Device } from './device.entity';
import { Topic } from './topic.entity';

@Entity('user_topics')
@Unique(['device_id', 'topic_id'])
@Index('idx_user_topics_device_active', ['device_id'], {
  where: '"is_active" = TRUE',
})
export class UserTopic {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_user_topics_device')
  @Column({ type: 'uuid' })
  device_id: string;

  @ManyToOne(() => Device, (d) => d.user_topics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: Device;

  @Column({ type: 'uuid' })
  topic_id: string;

  @ManyToOne(() => Topic, (t) => t.user_topics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  followed_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_fact_served_at: Date | null;

  @Column({ type: 'int', default: 0 })
  unseen_fact_count: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

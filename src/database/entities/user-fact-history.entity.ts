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
import { Fact } from './fact.entity';
import { Topic } from './topic.entity';

@Entity('user_fact_history')
@Unique(['device_id', 'fact_id'])
export class UserFactHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_history_device')
  @Column({ type: 'uuid' })
  device_id: string;

  @ManyToOne(() => Device, (d) => d.fact_history, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: Device;

  @Column({ type: 'uuid' })
  fact_id: string;

  @ManyToOne(() => Fact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fact_id' })
  fact: Fact;

  @Index('idx_history_device_topic')
  @Column({ type: 'uuid' })
  topic_id: string;

  @ManyToOne(() => Topic)
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  seen_at: Date;

  @Column({ type: 'boolean', default: false })
  read_fully: boolean;
}

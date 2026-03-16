import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Device } from './device.entity';
import { Fact } from './fact.entity';
import { UserTopic } from './user-topic.entity';

@Entity('topics')
export class Topic {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_topics_slug', { unique: true })
  @Column({ type: 'text', unique: true })
  slug: string;

  @Column({ type: 'text' })
  display_name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Index('idx_topics_is_preset')
  @Column({ type: 'boolean', default: false })
  is_preset: boolean;

  @Index('idx_topics_category')
  @Column({ type: 'text' })
  category: string;

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @Column({ type: 'int', default: 0 })
  fact_count: number;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @ManyToOne(() => Device, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: Device;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @OneToMany(() => Fact, (f) => f.topic)
  facts: Fact[];

  @OneToMany(() => UserTopic, (ut) => ut.topic)
  user_topics: UserTopic[];
}

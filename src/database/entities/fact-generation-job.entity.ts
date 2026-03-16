import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Topic } from './topic.entity';

@Entity('fact_generation_jobs')
export class FactGenerationJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_jobs_topic_status')
  @Column({ type: 'uuid' })
  topic_id: string;

  @ManyToOne(() => Topic)
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @Column({ type: 'text' })
  triggered_by: 'low_stock' | 'new_topic' | 'manual';

  @Column({ type: 'text', default: 'pending' })
  status: 'pending' | 'running' | 'done' | 'failed';

  @Column({ type: 'int', default: 10 })
  facts_requested: number;

  @Column({ type: 'int', default: 0 })
  facts_created: number;

  @Column({ type: 'int', default: 0 })
  facts_rejected: number;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

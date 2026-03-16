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

@Entity('facts')
@Index('idx_facts_topic_active', ['topic_id'], {
  where: '"is_active" = TRUE',
})
export class Fact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_facts_topic_id')
  @Column({ type: 'uuid' })
  topic_id: string;

  @ManyToOne(() => Topic, (t) => t.facts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'topic_id' })
  topic: Topic;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', array: true })
  lines: string[];

  @Column({ type: 'text', nullable: true })
  source_hint: string;

  // pgvector column — managed via raw SQL migrations, not TypeORM
  // embedding vector(1536)

  @Column({ type: 'float', nullable: true })
  quality_score: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'uuid', nullable: true })
  generation_job_id: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}

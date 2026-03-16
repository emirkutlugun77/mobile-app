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

@Entity('user_favorites')
@Unique(['device_id', 'fact_id'])
export class UserFavorite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_favorites_device')
  @Column({ type: 'uuid' })
  device_id: string;

  @ManyToOne(() => Device, (d) => d.favorites, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: Device;

  @Column({ type: 'uuid' })
  fact_id: string;

  @ManyToOne(() => Fact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fact_id' })
  fact: Fact;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  favorited_at: Date;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ValidateNested,
  IsString,
  IsUUID,
  IsBoolean,
  IsOptional,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SyncEventDto {
  @ApiProperty({ enum: ['seen', 'favorite'], example: 'seen' })
  @IsIn(['seen', 'favorite'])
  type: 'seen' | 'favorite';

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  fact_id: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  read_fully?: boolean;

  @ApiProperty({ example: '2026-03-08T07:00:00Z' })
  @IsString()
  occurred_at: string;
}

export class SyncEventsDto {
  @ApiProperty({ type: [SyncEventDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncEventDto)
  events: SyncEventDto[];
}

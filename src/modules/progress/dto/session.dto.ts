import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class SessionDto {
  @ApiProperty({ description: 'Number of facts read in this session', example: 5, minimum: 1 })
  @IsInt()
  @Min(1)
  facts_read_count: number;

  @ApiProperty({ description: 'Date of the session in YYYY-MM-DD format', example: '2026-03-08' })
  @IsString()
  session_date: string;

  @ApiProperty({ description: 'IANA timezone string', example: 'Europe/Istanbul' })
  @IsString()
  timezone: string;
}

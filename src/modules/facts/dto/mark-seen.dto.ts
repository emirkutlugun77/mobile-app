import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class MarkSeenDto {
  @ApiPropertyOptional({
    description: 'Whether the user read all beats of the fact',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  read_fully?: boolean;
}

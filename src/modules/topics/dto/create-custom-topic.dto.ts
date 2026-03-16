import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateCustomTopicDto {
  @ApiProperty({
    description: 'Display name for the custom topic',
    example: 'WW2 Tanks',
    maxLength: 100,
  })
  @IsString()
  @MaxLength(100)
  display_name: string;

  @ApiPropertyOptional({
    description: 'Short description of the topic',
    example: 'The armored vehicles that shaped World War II.',
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}

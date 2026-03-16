import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class UpdateDeviceDto {
  @ApiPropertyOptional({
    description: 'IANA timezone string',
    example: 'America/Los_Angeles',
  })
  @IsString()
  @IsOptional()
  timezone?: string;
}

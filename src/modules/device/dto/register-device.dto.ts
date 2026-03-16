import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'iOS-generated UUID from Keychain',
    example: 'A3F2B1C4-1234-5678-ABCD-EF0123456789',
  })
  @IsUUID()
  device_id: string;

  @ApiPropertyOptional({
    description: 'IANA timezone string',
    example: 'Europe/Istanbul',
  })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ example: 'ios' })
  @IsString()
  @IsOptional()
  platform?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsString()
  @IsOptional()
  app_version?: string;
}

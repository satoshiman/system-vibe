import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({
    description: 'Overall health status',
    enum: ['healthy', 'degraded'],
    example: 'healthy',
  })
  status!: string;

  @ApiProperty({
    description: 'ISO timestamp of health check',
    example: '2024-01-01T00:00:00.000Z',
  })
  timestamp!: string;

  @ApiProperty({
    description: 'Individual service statuses',
    type: 'object',
    example: {
      api: 'healthy',
      database: 'healthy',
      redis: 'healthy',
      queue: 'healthy',
      worker: 'healthy',
      auth: 'healthy',
    },
  })
  services!: {
    api: string;
    database: string;
    redis: string;
    queue: string;
    worker: string;
    auth: string;
  };

  @ApiProperty({
    description: 'API version',
    example: '0.3.0',
  })
  version!: string;
}

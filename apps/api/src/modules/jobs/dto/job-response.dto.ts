import { ApiProperty } from '@nestjs/swagger';

export class JobResponseDto {
  @ApiProperty({ description: 'Job ID', example: 'cl1234567890' })
  id!: string;

  @ApiProperty({ description: 'Job type', example: 'image-resize' })
  type!: string;

  @ApiProperty({ description: 'User ID who submitted the job', example: 'cl0987654321' })
  userId!: string;

  @ApiProperty({ description: 'Job input data' })
  payload!: Record<string, unknown>;

  @ApiProperty({
    description: 'Job status',
    example: 'PENDING',
    enum: ['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  })
  status!: string;

  @ApiProperty({ description: 'Job creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Job start timestamp', required: false })
  startedAt?: Date;

  @ApiProperty({ description: 'Job completion timestamp', required: false })
  completedAt?: Date;

  @ApiProperty({ description: 'Job result data', required: false })
  result?: Record<string, unknown>;

  @ApiProperty({ description: 'Error message if failed', required: false })
  error?: string;

  @ApiProperty({ description: 'Current attempt count', example: 0 })
  attemptCount!: number;

  @ApiProperty({ description: 'Maximum retry attempts', example: 3 })
  maxRetries!: number;

  @ApiProperty({ description: 'Next retry timestamp', required: false })
  nextRetryAt?: Date;

  @ApiProperty({
    description: 'Job priority',
    example: 'normal',
    enum: ['low', 'normal', 'high'],
  })
  priority!: string;

  @ApiProperty({ description: 'Job timeout in seconds', example: 3600 })
  timeout!: number;

  @ApiProperty({ description: 'Webhook URL for notifications', required: false })
  webhookUrl?: string;
}

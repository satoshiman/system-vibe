import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsNumber,
  Min,
  Max,
  IsObject,
} from 'class-validator';

export class CreateJobDto {
  @ApiProperty({
    description: 'Type of job to process',
    example: 'image-resize',
    enum: [
      'image-resize',
      'image-thumbnail',
      'image-compress',
      'video-transcode',
      'ai-inference',
      'email-send',
    ],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn([
    'image-resize',
    'image-thumbnail',
    'image-compress',
    'video-transcode',
    'ai-inference',
    'email-send',
  ])
  type!: string;

  @ApiProperty({
    description: 'Job-specific input data',
    example: { imageUrl: 'https://example.com/image.jpg', width: 800, height: 600 },
  })
  @IsNotEmpty()
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiProperty({
    description: 'Job priority',
    example: 'normal',
    enum: ['low', 'normal', 'high'],
    required: false,
  })
  @IsOptional()
  @IsIn(['low', 'normal', 'high'])
  priority?: string;

  @ApiProperty({
    description: 'Job timeout in seconds',
    example: 3600,
    required: false,
    minimum: 1,
    maximum: 86400,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(86400)
  timeout?: number;

  @ApiProperty({
    description: 'Webhook URL to notify on completion',
    example: 'https://example.com/webhook',
    required: false,
  })
  @IsOptional()
  @IsString()
  webhookUrl?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsIn, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class FilterJobsDto {
  @ApiProperty({
    description: 'Filter by job status',
    example: 'PROCESSING',
    enum: ['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    required: false,
  })
  @IsOptional()
  @IsIn(['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  status?: string;

  @ApiProperty({
    description: 'Filter by job type',
    example: 'image-resize',
    required: false,
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({
    description: 'Page number',
    example: 1,
    required: false,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiProperty({
    description: 'Items per page',
    example: 20,
    required: false,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

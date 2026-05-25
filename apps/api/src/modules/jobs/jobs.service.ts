import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@systemvibe/database';
import { CreateJobDto } from './dto/create-job.dto';
import { JobResponseDto } from './dto/job-response.dto';
import { FilterJobsDto } from './dto/filter-jobs.dto';

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('image') private imageQueue: Queue
  ) {}

  async create(createJobDto: CreateJobDto): Promise<JobResponseDto> {
    // Create job in database without userId (public job)
    const job = await this.prisma.job.create({
      data: {
        type: createJobDto.type,
        userId: null,
        payload: createJobDto.payload as any,
        priority: createJobDto.priority || 'normal',
        timeout: createJobDto.timeout || 3600,
        webhookUrl: createJobDto.webhookUrl,
        status: 'PENDING',
      },
    });

    // Add job to BullMQ queue
    await this.imageQueue.add(
      createJobDto.type,
      {
        jobId: job.id,
        type: createJobDto.type,
        payload: createJobDto.payload,
      },
      {
        jobId: job.id,
        priority: this.getPriorityValue(createJobDto.priority || 'normal'),
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );

    // Update job status to QUEUED
    const updatedJob = await this.prisma.job.update({
      where: { id: job.id },
      data: { status: 'QUEUED' },
    });

    return this.toJobResponseDto(updatedJob);
  }

  async findOne(id: string): Promise<JobResponseDto> {
    const job = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    return this.toJobResponseDto(job);
  }

  async findAll(filterDto: FilterJobsDto): Promise<{ jobs: JobResponseDto[]; total: number }> {
    const { status, type, priority, page = 1, limit = 20 } = filterDto;
    const skip = (Number(page) - 1) * Number(limit);
    const limitNumber = Number(limit);

    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    if (priority) {
      where.priority = priority;
    }

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        skip,
        take: limitNumber,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      jobs: jobs.map((job: { [key: string]: unknown }) => this.toJobResponseDto(job)),
      total,
    };
  }

  async cancel(id: string): Promise<JobResponseDto> {
    const job = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    if (
      job.status === 'PROCESSING' ||
      job.status === 'COMPLETED' ||
      job.status === 'FAILED' ||
      job.status === 'CANCELLED'
    ) {
      throw new BadRequestException(`Cannot cancel job with status ${job.status}`);
    }

    // Remove from queue
    try {
      await this.imageQueue.remove(job.id);
    } catch (error) {
      // Job might not be in queue anymore, continue with database update
    }

    // Update job status
    const updatedJob = await this.prisma.job.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    return this.toJobResponseDto(updatedJob);
  }

  private getPriorityValue(priority: string): number {
    const priorityMap: Record<string, number> = {
      low: 5,
      normal: 10,
      high: 1,
    };
    return priorityMap[priority] || 10;
  }

  private toJobResponseDto(job: { [key: string]: unknown }): JobResponseDto {
    return {
      id: job.id as string,
      type: job.type as string,
      userId: job.userId as string,
      payload: job.payload as Record<string, unknown>,
      status: job.status as string,
      createdAt: job.createdAt as Date,
      startedAt: job.startedAt as Date | undefined,
      completedAt: job.completedAt as Date | undefined,
      result: job.result as Record<string, unknown> | undefined,
      error: job.error as string | undefined,
      attemptCount: job.attemptCount as number,
      maxRetries: job.maxRetries as number,
      nextRetryAt: job.nextRetryAt as Date | undefined,
      priority: job.priority as string,
      timeout: job.timeout as number,
      webhookUrl: job.webhookUrl as string | undefined,
    };
  }
}

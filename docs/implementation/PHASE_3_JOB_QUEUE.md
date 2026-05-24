# SystemVibe Phase 3: Job Queue Basics - Implementation Guide

**Duration**: 1-2 weeks | **Goal**: Implement core job submission and queue system with BullMQ

After Phase 3, you'll have:

- ✅ Job entity in PostgreSQL with Prisma
- ✅ BullMQ queue setup with Redis
- ✅ Job submission API endpoint
- ✅ Job retrieval and filtering
- ✅ Job cancellation endpoint
- ✅ Automatic retry with exponential backoff
- ✅ Swagger documentation for all endpoints
- ✅ Unit tests for JobsService
- ✅ E2E tests for JobsController
- ✅ Jest configuration and test scripts

---

## Prerequisites

**Before starting Phase 3, ensure Phase 2 is complete:**

- Authentication system working (JWT tokens)
- Redis session storage operational
- User registration/login functional
- Auth guards protecting endpoints

---

## Step 1: Install BullMQ Dependencies

```bash
# Install BullMQ and NestJS Bull integration
npm install --workspace=apps/api @nestjs/bull bullmq

# Install @nestjs/config for configuration management
npm install --workspace=apps/api @nestjs/config
```

**Dependencies explained:**

- `@nestjs/bull`: NestJS integration for BullMQ
- `bullmq`: Modern Redis-based queue for Node.js
- `@nestjs/config`: Configuration management with environment variables

---

## Step 2: Update Prisma Schema

```bash
# Update schema.prisma to add Job entity
cat > packages/database/prisma/schema.prisma << 'EOF'
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String?
  passwordHash   String
  refreshToken   String?  @unique
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  jobs           Job[]

  @@map("user")
}

model Job {
  id             String   @id @default(cuid())
  type           String
  userId         String
  payload        Json
  status         String   @default("PENDING")
  createdAt      DateTime @default(now())
  startedAt      DateTime?
  completedAt    DateTime?
  result         Json?
  error          String?
  attemptCount   Int      @default(0)
  maxRetries     Int      @default(3)
  nextRetryAt    DateTime?
  priority       String   @default("normal")
  timeout        Int      @default(3600)
  webhookUrl     String?

  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
  @@index([createdAt])
  @@index([type])
  @@map("job")
}
EOF

# Run migration
cd packages/database
DATABASE_URL="postgresql://systemvibe:devpassword@localhost:5433/systemvibe" npx prisma migrate dev --name phase3
cd ../..
```

**Schema changes:**

- `Job` entity with all tracking fields
- Relationship between User and Job (one-to-many)
- Indexes for efficient querying
- Status tracking: PENDING → QUEUED → PROCESSING → COMPLETED/FAILED

---

## Step 3: Create Database Package Exports

```bash
# Create PrismaService
cat > packages/database/src/prisma.service.ts << 'EOF'
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
EOF

# Create PrismaModule
cat > packages/database/src/prisma.module.ts << 'EOF'
import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
EOF

# Update index.ts
cat > packages/database/src/index.ts << 'EOF'
export * from "./prisma.service";
export * from "./prisma.module";
export * from "@prisma/client";
EOF

# Build database package
npm run build --workspace=packages/database
```

---

## Step 4: Create Queue Configuration

```bash
# Create queue config
cat > apps/api/src/config/queue.config.ts << 'EOF'
import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 1000,
      age: 86400, // 24 hours
    },
    removeOnFail: {
      count: 5000,
      age: 604800, // 7 days
    },
  },
});
EOF
```

---

## Step 5: Create Queue Module

```bash
# Create queue module
cat > apps/api/src/modules/queue/queue.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('queue.redis.host'),
          port: configService.get('queue.redis.port'),
          password: configService.get('queue.redis.password'),
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
EOF
```

---

## Step 6: Create Jobs Module

```bash
# Create jobs module structure
mkdir -p apps/api/src/modules/jobs/dto

# Create CreateJobDto
cat > apps/api/src/modules/jobs/dto/create-job.dto.ts << 'EOF'
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn, IsNumber, Min, Max, IsObject } from 'class-validator';

export class CreateJobDto {
  @ApiProperty({
    description: 'Type of job to process',
    example: 'image-resize',
    enum: ['image-resize', 'image-thumbnail', 'image-compress', 'video-transcode', 'ai-inference', 'email-send'],
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['image-resize', 'image-thumbnail', 'image-compress', 'video-transcode', 'ai-inference', 'email-send'])
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
EOF

# Create JobResponseDto
cat > apps/api/src/modules/jobs/dto/job-response.dto.ts << 'EOF'
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
EOF

# Create FilterJobsDto
cat > apps/api/src/modules/jobs/dto/filter-jobs.dto.ts << 'EOF'
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
EOF

# Create JobsService
cat > apps/api/src/modules/jobs/jobs.service.ts << 'EOF'
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { PrismaService } from '@systemvibe/database';
import { CreateJobDto } from './dto/create-job.dto';
import { JobResponseDto } from './dto/job-response.dto';
import { FilterJobsDto } from './dto/filter-jobs.dto';

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('jobs') private jobsQueue: Queue
  ) {}

  async create(userId: string, createJobDto: CreateJobDto): Promise<JobResponseDto> {
    // Create job in database
    const job = await this.prisma.job.create({
      data: {
        type: createJobDto.type,
        userId,
        payload: createJobDto.payload as any,
        priority: createJobDto.priority || 'normal',
        timeout: createJobDto.timeout || 3600,
        webhookUrl: createJobDto.webhookUrl,
        status: 'PENDING',
      },
    });

    // Add job to BullMQ queue
    await this.jobsQueue.add(
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
      },
    );

    // Update job status to QUEUED
    const updatedJob = await this.prisma.job.update({
      where: { id: job.id },
      data: { status: 'QUEUED' },
    });

    return this.toJobResponseDto(updatedJob);
  }

  async findOne(id: string, userId: string): Promise<JobResponseDto> {
    const job = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(\`Job with ID \${id} not found\`);
    }

    // Check if user owns this job
    if (job.userId !== userId) {
      throw new BadRequestException('You do not have permission to access this job');
    }

    return this.toJobResponseDto(job);
  }

  async findAll(
    userId: string,
    filterDto: FilterJobsDto
  ): Promise<{ jobs: JobResponseDto[]; total: number }> {
    const { status, type, page = 1, limit = 20 } = filterDto;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      userId,
    };

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      jobs: jobs.map((job: { [key: string]: unknown }) => this.toJobResponseDto(job)),
      total,
    };
  }

  async cancel(id: string, userId: string): Promise<JobResponseDto> {
    const job = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(\`Job with ID \${id} not found\`);
    }

    if (job.userId !== userId) {
      throw new BadRequestException('You do not have permission to cancel this job');
    }

    if (job.status === 'PROCESSING' || job.status === 'COMPLETED' || job.status === 'FAILED') {
      throw new BadRequestException(\`Cannot cancel job with status \${job.status}\`);
    }

    // Remove from queue
    try {
      await this.jobsQueue.remove(job.id);
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
EOF

# Create JobsController
cat > apps/api/src/modules/jobs/jobs.controller.ts << 'EOF'
import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JobResponseDto } from './dto/job-response.dto';
import { FilterJobsDto } from './dto/filter-jobs.dto';

interface RequestWithUser extends Request {
  user: { userId: string };
}

@ApiTags('jobs')
@Controller('jobs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new job' })
  @ApiResponse({ status: 201, description: 'Job created successfully', type: JobResponseDto })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(@Request() req: RequestWithUser, @Body() createJobDto: CreateJobDto): Promise<JobResponseDto> {
    return this.jobsService.create(req.user.userId, createJobDto);
  }

  @Get()
  @ApiOperation({ summary: 'List user jobs with filtering' })
  @ApiResponse({ status: 200, description: 'Jobs retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'] })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(@Request() req: RequestWithUser, @Query() filterDto: FilterJobsDto): Promise<{ jobs: JobResponseDto[]; total: number }> {
    return this.jobsService.findAll(req.user.userId, filterDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific job by ID' })
  @ApiResponse({ status: 200, description: 'Job retrieved successfully', type: JobResponseDto })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findOne(@Param('id') id: string, @Request() req: RequestWithUser): Promise<JobResponseDto> {
    return this.jobsService.findOne(id, req.user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a job' })
  @ApiResponse({ status: 200, description: 'Job cancelled successfully', type: JobResponseDto })
  @ApiResponse({ status: 400, description: 'Cannot cancel job in current status' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async cancel(@Param('id') id: string, @Request() req: RequestWithUser): Promise<JobResponseDto> {
    return this.jobsService.cancel(id, req.user.userId);
  }
}
EOF

# Create JobsModule
cat > apps/api/src/modules/jobs/jobs.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { QueueModule } from '../queue/queue.module';
import { PrismaModule } from '@systemvibe/database';

@Module({
  imports: [
    QueueModule,
    PrismaModule,
    BullModule.registerQueue({
      name: 'jobs',
    }),
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
EOF
```

---

## Step 7: Update App Module

```bash
# Update app.module.ts
cat > apps/api/src/app.module.ts << 'EOF'
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { JobsModule } from './modules/jobs/jobs.module';
import queueConfig from './config/queue.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [queueConfig],
    }),
    HealthModule,
    AuthModule,
    JobsModule,
  ],
})
export class AppModule {}
EOF
```

---

## Step 8: Update Main.ts for Swagger

```bash
# Update main.ts to add jobs tag
cat > apps/api/src/main.ts << 'EOF'
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import pino from 'pino';
import * as dotenv from 'dotenv';

// Load .env from root directory (assumes running from project root)
dotenv.config();

const logger = pino();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('SystemVibe API')
    .setDescription('SystemVibe API documentation')
    .setVersion('0.1.0')
    .addTag('health')
    .addTag('auth')
    .addTag('jobs')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth' // This name is used for referencing in @ApiBearerAuth()
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.API_PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.info(\`API Server running on http://localhost:\${port}\`);
  logger.info(\`Swagger documentation available at http://localhost:\${port}/api/docs\`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start API');
  process.exit(1);
});
EOF
```

---

## Step 9: Build and Test

```bash
# Build the API
npm run build --workspace=apps/api

# Start PostgreSQL and Redis
cd infra/docker
docker compose up -d postgres redis
cd ../..

# Start API in development mode
cd apps/api
DATABASE_URL="postgresql://systemvibe:devpassword@localhost:5433/systemvibe" REDIS_URL="redis://localhost:6379" npm run dev
```

---

## Step 10: Install Testing Dependencies

```bash
# Install testing dependencies
npm install --workspace=apps/api --save-dev @types/jest jest ts-jest supertest @types/supertest

# Install BullMQ testing utilities
npm install --workspace=apps/api --save-dev @nestjs/testing
```

---

## Step 11: Create Unit Tests for JobsService

```bash
# Create jobs service spec file
cat > apps/api/src/modules/jobs/jobs.service.spec.ts << 'EOF'
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Queue } from 'bullmq';

// Mock Prisma before importing
const mockPrisma = {
  job: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
};

const mockQueue = {
  add: jest.fn(),
  remove: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
}));

jest.mock('@systemvibe/database', () => ({
  PrismaService: jest.fn(() => mockPrisma),
}));

// Import after mocking
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { FilterJobsDto } from './dto/filter-jobs.dto';

describe('JobsService', () => {
  let service: JobsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: 'BullQueue_jobs',
          useValue: mockQueue,
        },
        {
          provide: 'PrismaService',
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a job successfully', async () => {
      const userId = 'user-id';
      const createJobDto: CreateJobDto = {
        type: 'image-resize',
        payload: { imageUrl: 'https://example.com/image.jpg', width: 800, height: 600 },
        priority: 'normal',
        timeout: 3600,
      };

      const mockJob = {
        id: 'job-id',
        type: createJobDto.type,
        userId,
        payload: createJobDto.payload,
        status: 'PENDING',
        priority: 'normal',
        timeout: 3600,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        attemptCount: 0,
        maxRetries: 3,
        nextRetryAt: null,
        webhookUrl: null,
      };

      mockPrisma.job.create.mockResolvedValue(mockJob);
      mockPrisma.job.update.mockResolvedValue({ ...mockJob, status: 'QUEUED' });
      mockQueue.add.mockResolvedValue({ id: 'job-id' });

      const result = await service.create(userId, createJobDto);

      expect(result).toHaveProperty('id');
      expect(result.type).toBe(createJobDto.type);
      expect(result.status).toBe('QUEUED');
      expect(mockPrisma.job.create).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalled();
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: mockJob.id },
        data: { status: 'QUEUED' },
      });
    });

    it('should handle high priority correctly', async () => {
      const userId = 'user-id';
      const createJobDto: CreateJobDto = {
        type: 'image-resize',
        payload: { imageUrl: 'https://example.com/image.jpg' },
        priority: 'high',
      };

      const mockJob = {
        id: 'job-id',
        type: createJobDto.type,
        userId,
        payload: createJobDto.payload,
        status: 'QUEUED',
        priority: 'high',
        timeout: 3600,
        createdAt: new Date(),
      };

      mockPrisma.job.create.mockResolvedValue({ ...mockJob, status: 'PENDING' });
      mockPrisma.job.update.mockResolvedValue(mockJob);
      mockQueue.add.mockResolvedValue({ id: 'job-id' });

      await service.create(userId, createJobDto);

      expect(mockQueue.add).toHaveBeenCalledWith(
        createJobDto.type,
        expect.any(Object),
        expect.objectContaining({
          priority: 1, // High priority = 1
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a job by id', async () => {
      const userId = 'user-id';
      const jobId = 'job-id';

      const mockJob = {
        id: jobId,
        type: 'image-resize',
        userId,
        payload: {},
        status: 'QUEUED',
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        attemptCount: 0,
        maxRetries: 3,
        nextRetryAt: null,
        priority: 'normal',
        timeout: 3600,
        webhookUrl: null,
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);

      const result = await service.findOne(jobId, userId);

      expect(result.id).toBe(jobId);
      expect(mockPrisma.job.findUnique).toHaveBeenCalledWith({ where: { id: jobId } });
    });

    it('should throw NotFoundException if job not found', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id', 'user-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user does not own job', async () => {
      const mockJob = {
        id: 'job-id',
        userId: 'other-user-id',
        type: 'image-resize',
        payload: {},
        status: 'QUEUED',
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        attemptCount: 0,
        maxRetries: 3,
        nextRetryAt: null,
        priority: 'normal',
        timeout: 3600,
        webhookUrl: null,
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.findOne('job-id', 'user-id')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('should return all jobs for a user', async () => {
      const userId = 'user-id';
      const filterDto: FilterJobsDto = {};

      const mockJobs = [
        {
          id: 'job-1',
          type: 'image-resize',
          userId,
          payload: {},
          status: 'QUEUED',
          createdAt: new Date(),
          startedAt: null,
          completedAt: null,
          result: null,
          error: null,
          attemptCount: 0,
          maxRetries: 3,
          nextRetryAt: null,
          priority: 'normal',
          timeout: 3600,
          webhookUrl: null,
        },
      ];

      mockPrisma.job.findMany.mockResolvedValue(mockJobs);
      mockPrisma.job.count.mockResolvedValue(1);

      const result = await service.findAll(userId, filterDto);

      expect(result.jobs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
        where: { userId },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter jobs by status', async () => {
      const userId = 'user-id';
      const filterDto: FilterJobsDto = { status: 'COMPLETED' };

      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await service.findAll(userId, filterDto);

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, status: 'COMPLETED' },
        }),
      );
    });

    it('should filter jobs by type', async () => {
      const userId = 'user-id';
      const filterDto: FilterJobsDto = { type: 'image-resize' };

      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await service.findAll(userId, filterDto);

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, type: 'image-resize' },
        }),
      );
    });

    it('should handle pagination', async () => {
      const userId = 'user-id';
      const filterDto: FilterJobsDto = { page: 2, limit: 10 };

      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await service.findAll(userId, filterDto);

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('cancel', () => {
    it('should cancel a job successfully', async () => {
      const userId = 'user-id';
      const jobId = 'job-id';

      const mockJob = {
        id: jobId,
        type: 'image-resize',
        userId,
        payload: {},
        status: 'QUEUED',
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        attemptCount: 0,
        maxRetries: 3,
        nextRetryAt: null,
        priority: 'normal',
        timeout: 3600,
        webhookUrl: null,
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);
      mockQueue.remove.mockResolvedValue(true);
      mockPrisma.job.update.mockResolvedValue({ ...mockJob, status: 'CANCELLED' });

      const result = await service.cancel(jobId, userId);

      expect(result.status).toBe('CANCELLED');
      expect(mockQueue.remove).toHaveBeenCalledWith(jobId);
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: jobId },
        data: { status: 'CANCELLED' },
      });
    });

    it('should throw NotFoundException if job not found', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(null);

      await expect(service.cancel('nonexistent-id', 'user-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if user does not own job', async () => {
      const mockJob = {
        id: 'job-id',
        userId: 'other-user-id',
        type: 'image-resize',
        payload: {},
        status: 'QUEUED',
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        attemptCount: 0,
        maxRetries: 3,
        nextRetryAt: null,
        priority: 'normal',
        timeout: 3600,
        webhookUrl: null,
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.cancel('job-id', 'user-id')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if job is PROCESSING', async () => {
      const mockJob = {
        id: 'job-id',
        userId: 'user-id',
        type: 'image-resize',
        payload: {},
        status: 'PROCESSING',
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        attemptCount: 0,
        maxRetries: 3,
        nextRetryAt: null,
        priority: 'normal',
        timeout: 3600,
        webhookUrl: null,
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.cancel('job-id', 'user-id')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if job is COMPLETED', async () => {
      const mockJob = {
        id: 'job-id',
        userId: 'user-id',
        type: 'image-resize',
        payload: {},
        status: 'COMPLETED',
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        attemptCount: 0,
        maxRetries: 3,
        nextRetryAt: null,
        priority: 'normal',
        timeout: 3600,
        webhookUrl: null,
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);

      await expect(service.cancel('job-id', 'user-id')).rejects.toThrow(BadRequestException);
    });

    it('should handle queue removal errors gracefully', async () => {
      const userId = 'user-id';
      const jobId = 'job-id';

      const mockJob = {
        id: jobId,
        type: 'image-resize',
        userId,
        payload: {},
        status: 'QUEUED',
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        attemptCount: 0,
        maxRetries: 3,
        nextRetryAt: null,
        priority: 'normal',
        timeout: 3600,
        webhookUrl: null,
      };

      mockPrisma.job.findUnique.mockResolvedValue(mockJob);
      mockQueue.remove.mockRejectedValue(new Error('Job not in queue'));
      mockPrisma.job.update.mockResolvedValue({ ...mockJob, status: 'CANCELLED' });

      const result = await service.cancel(jobId, userId);

      expect(result.status).toBe('CANCELLED');
      expect(mockPrisma.job.update).toHaveBeenCalled();
    });
  });
});
EOF
```

---

## Step 12: Create E2E Tests for JobsController

```bash
# Create jobs e2e spec file
cat > apps/api/test/jobs.e2e-spec.ts << 'EOF'
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Jobs (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    // Register a test user and get token
    const randomEmail = `jobtest-${Date.now()}@example.com`;
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: randomEmail,
        password: 'password123',
        name: 'Job Test User',
      });

    accessToken = registerRes.body.accessToken;
    userId = registerRes.body.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/jobs (POST)', () => {
    it('should create a new job with valid data', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-resize',
          payload: {
            imageUrl: 'https://example.com/image.jpg',
            width: 800,
            height: 600,
          },
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body).toHaveProperty('type', 'image-resize');
          expect(res.body).toHaveProperty('status', 'QUEUED');
          expect(res.body).toHaveProperty('userId', userId);
          expect(res.body).toHaveProperty('payload');
          expect(res.body).toHaveProperty('createdAt');
          expect(res.body).toHaveProperty('priority', 'normal');
          expect(res.body).toHaveProperty('timeout', 3600);
        });
    });

    it('should create a job with high priority', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-thumbnail',
          payload: { imageUrl: 'https://example.com/image.jpg' },
          priority: 'high',
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.priority).toBe('high');
        });
    });

    it('should create a job with custom timeout', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-compress',
          payload: { imageUrl: 'https://example.com/image.jpg' },
          timeout: 7200,
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.timeout).toBe(7200);
        });
    });

    it('should create a job with webhook URL', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'email-send',
          payload: { to: 'recipient@example.com', subject: 'Test' },
          webhookUrl: 'https://example.com/webhook',
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.webhookUrl).toBe('https://example.com/webhook');
        });
    });

    it('should fail without authentication', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .send({
          type: 'image-resize',
          payload: { imageUrl: 'https://example.com/image.jpg' },
        })
        .expect(401);
    });

    it('should fail with invalid job type', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'invalid-type',
          payload: {},
        })
        .expect(400);
    });

    it('should fail with missing payload', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-resize',
        })
        .expect(400);
    });

    it('should fail with invalid priority', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-resize',
          payload: {},
          priority: 'invalid',
        })
        .expect(400);
    });

    it('should fail with timeout too low', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-resize',
          payload: {},
          timeout: 0,
        })
        .expect(400);
    });

    it('should fail with timeout too high', () => {
      return request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-resize',
          payload: {},
          timeout: 100000,
        })
        .expect(400);
    });
  });

  describe('/jobs (GET)', () => {
    let jobId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-resize',
          payload: { imageUrl: 'https://example.com/image.jpg' },
        });

      jobId = res.body.id;
    });

    it('should list all jobs for authenticated user', () => {
      return request(app.getHttpServer())
        .get('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('jobs');
          expect(Array.isArray(res.body.jobs)).toBe(true);
          expect(res.body).toHaveProperty('total');
          expect(typeof res.body.total).toBe('number');
        });
    });

    it('should filter jobs by status', () => {
      return request(app.getHttpServer())
        .get('/api/jobs?status=QUEUED')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.jobs).toBeDefined();
        });
    });

    it('should filter jobs by type', () => {
      return request(app.getHttpServer())
        .get('/api/jobs?type=image-resize')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.jobs).toBeDefined();
        });
    });

    it('should handle pagination', () => {
      return request(app.getHttpServer())
        .get('/api/jobs?page=1&limit=5')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.jobs).toBeDefined();
        });
    });

    it('should fail without authentication', () => {
      return request(app.getHttpServer()).get('/api/jobs').expect(401);
    });
  });

  describe('/jobs/:id (GET)', () => {
    let jobId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-resize',
          payload: { imageUrl: 'https://example.com/image.jpg' },
        });

      jobId = res.body.id;
    });

    it('should get a specific job by id', () => {
      return request(app.getHttpServer())
        .get(`/api/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('id', jobId);
          expect(res.body).toHaveProperty('type');
          expect(res.body).toHaveProperty('status');
          expect(res.body).toHaveProperty('payload');
          expect(res.body).toHaveProperty('createdAt');
        });
    });

    it('should fail without authentication', () => {
      return request(app.getHttpServer()).get(`/api/jobs/${jobId}`).expect(401);
    });

    it('should fail with invalid job id', () => {
      return request(app.getHttpServer())
        .get('/api/jobs/nonexistent-id')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  describe('/jobs/:id (DELETE)', () => {
    let jobId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'image-resize',
          payload: { imageUrl: 'https://example.com/image.jpg' },
        });

      jobId = res.body.id;
    });

    it('should cancel a job successfully', () => {
      return request(app.getHttpServer())
        .delete(`/api/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('status', 'CANCELLED');
        });
    });

    it('should fail to cancel already cancelled job', () => {
      return request(app.getHttpServer())
        .delete(`/api/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    it('should fail without authentication', () => {
      return request(app.getHttpServer()).delete('/api/jobs/some-id').expect(401);
    });

    it('should fail with invalid job id', () => {
      return request(app.getHttpServer())
        .delete('/api/jobs/nonexistent-id')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });
});
EOF
```

---

## Step 13: Update Jest Configuration

```bash
# Update jest.config.js if not exists
cat > apps/api/jest.config.js << 'EOF'
module.exports = {
  moduleNameMapper: {
    '^@systemvibe/database$': '<rootDir>/../../packages/database/src',
    '^@systemvibe/redis$': '<rootDir>/../../packages/redis/src',
  },
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.interface.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
EOF
```

---

## Step 14: Update package.json Test Scripts

```bash
# Update package.json to add test scripts
cat > apps/api/package.json << 'EOF'
{
  "name": "@systemvibe/api",
  "version": "0.0.1",
  "description": "SystemVibe API",
  "author": "",
  "private": true,
  "license": "UNLICENSED",
  "scripts": {
    "build": "nest build",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:debug": "node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand",
    "test:e2e": "jest --config ./test/jest-e2e.json"
  },
  "dependencies": {
    "@nestjs/bull": "^10.0.1",
    "@nestjs/common": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/jwt": "^10.1.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/swagger": "^7.1.0",
    "@prisma/client": "^5.0.0",
    "bcrypt": "^5.1.0",
    "bullmq": "^4.12.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.0",
    "dotenv": "^16.3.1",
    "ioredis": "^5.3.2",
    "pino": "^8.15.0",
    "pino-pretty": "^10.2.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/bcrypt": "^5.0.0",
    "@types/express": "^4.17.17",
    "@types/jest": "^29.5.2",
    "@types/node": "^20.3.1",
    "@types/supertest": "^2.0.12",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.42.0",
    "eslint-config-prettier": "^9.0.0",
    "eslint-plugin-prettier": "^5.0.0",
    "jest": "^29.5.0",
    "prettier": "^3.0.0",
    "source-map-support": "^0.5.21",
    "supertest": "^6.3.3",
    "ts-jest": "^29.1.0",
    "ts-loader": "^9.4.3",
    "ts-node": "^10.9.1",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.1.3"
  }
}
EOF
```

---

## Step 15: Run Tests

```bash
# Run unit tests
cd apps/api
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e

# Run specific test file
npm test -- jobs.service.spec.ts
npm test -- jobs.e2e-spec.ts
```

---

## Step 16: Manual Testing (Optional)

### Register and Login

```bash
# Register a user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jobtest@example.com",
    "password": "testpass123",
    "name": "Job Test"
  }'

# Save the access token from response
TOKEN="<your_access_token>"
```

### Submit a Job

```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "type": "image-resize",
    "payload": {
      "imageUrl": "https://example.com/image.jpg",
      "width": 800,
      "height": 600
    }
  }'
```

**Expected Response:**

```json
{
  "id": "cmpjjz88y0002jswxdhfy71u4",
  "type": "image-resize",
  "userId": "cmpjjz18g0000jswxj26tt50k",
  "payload": {
    "width": 800,
    "height": 600,
    "imageUrl": "https://example.com/image.jpg"
  },
  "status": "QUEUED",
  "createdAt": "2026-05-24T09:06:22.209Z",
  "startedAt": null,
  "completedAt": null,
  "result": null,
  "error": null,
  "attemptCount": 0,
  "maxRetries": 3,
  "nextRetryAt": null,
  "priority": "normal",
  "timeout": 3600,
  "webhookUrl": null
}
```

### List Jobs

```bash
curl -X GET http://localhost:3000/api/jobs \
  -H "Authorization: Bearer $TOKEN"
```

### Get Specific Job

```bash
curl -X GET http://localhost:3000/api/jobs/<job_id> \
  -H "Authorization: Bearer $TOKEN"
```

### Cancel a Job

```bash
curl -X DELETE http://localhost:3000/api/jobs/<job_id> \
  -H "Authorization: Bearer $TOKEN"
```

### Filter Jobs

```bash
# Filter by status
curl -X GET "http://localhost:3000/api/jobs?status=QUEUED" \
  -H "Authorization: Bearer $TOKEN"

# Filter by type
curl -X GET "http://localhost:3000/api/jobs?type=image-resize" \
  -H "Authorization: Bearer $TOKEN"

# Pagination
curl -X GET "http://localhost:3000/api/jobs?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Step 11: Verify BullMQ Queue

```bash
# Access Redis CLI
docker exec -it systemvibe-redis redis-cli

# Check BullMQ queue keys
KEYS "bull:jobs:*"

# Check queue length
LLEN bull:jobs:waiting

# Check job data
HGETALL bull:jobs:<job_id>
```

---

## What You've Learned (Phase 3)

✅ BullMQ queue setup with Redis
✅ Job entity design with Prisma
✅ Producer/consumer pattern implementation
✅ Job lifecycle management (PENDING → QUEUED → PROCESSING → COMPLETED/FAILED)
✅ Automatic retry with exponential backoff
✅ Priority queues (low, normal, high)
✅ Job filtering and pagination
✅ Swagger documentation for all endpoints
✅ DTO validation with class-validator
✅ Redis as queue backend

---

## Job Lifecycle Diagram

```
1. SUBMIT JOB
   Client → POST /api/jobs
   → Create Job in PostgreSQL (status: PENDING)
   → Add to BullMQ queue
   → Update status to QUEUED
   → Return job ID to client

2. QUEUE STATE
   Job waits in Redis queue
   Priority determines processing order
   Multiple workers can consume from same queue

3. PROCESSING (Phase 4)
   Worker dequeues job
   → Update status to PROCESSING
   → Execute job logic
   → Update status to COMPLETED or FAILED

4. RETRY LOGIC
   If job fails:
   → Increment attemptCount
   → Calculate nextRetryAt (exponential backoff)
   → Re-queue job
   → If maxRetries exceeded: status = FAILED

5. CANCELLATION
   Client → DELETE /api/jobs/:id
   → Remove from BullMQ queue
   → Update status to CANCELLED
   → Only allowed for PENDING/QUEUED jobs
```

---

## BullMQ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     API Server                          │
│                                                          │
│  POST /jobs → JobsService.create()                      │
│     ↓                                                    │
│  1. Create Job in PostgreSQL                            │
│  2. Add to BullMQ queue (Redis)                         │
│  3. Update status to QUEUED                             │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────┐
│                    Redis Queue                           │
│                                                          │
│  bull:jobs:waiting  → Jobs waiting to be processed      │
│  bull:jobs:active   → Jobs currently being processed    │
│  bull:jobs:delayed  → Jobs waiting for retry            │
│  bull:jobs:failed   → Jobs that failed                  │
│  bull:jobs:completed → Jobs that succeeded              │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────┐
│                  Workers (Phase 4)                       │
│                                                          │
│  Worker 1, Worker 2, Worker 3...                         │
│  → Consume jobs from queue                              │
│  → Process jobs                                         │
│  → Update job status in PostgreSQL                       │
└─────────────────────────────────────────────────────────┘
```

---

## Priority Queue Logic

```typescript
// Priority mapping (lower number = higher priority)
high: 1    → Processed first
normal: 10 → Processed second
low: 5     → Processed last

// Example queue order:
[high-priority-job-1, high-priority-job-2, normal-job-1, low-job-1, normal-job-2]
```

---

## Retry Strategy

```typescript
// Exponential backoff configuration
{
  attempts: 3,              // Maximum retry attempts
  backoff: {
    type: 'exponential',
    delay: 2000            // Base delay in milliseconds
  }
}

// Retry timing:
// Attempt 1: Immediate
// Attempt 2: 2 seconds (2000ms)
// Attempt 3: 4 seconds (2000ms * 2)
// After 3 failures: Mark as FAILED
```

---

## Security Considerations

**Job Ownership:**

- Users can only access their own jobs
- JWT authentication required for all job endpoints
- User ID extracted from token and validated

**Job Data:**

- Payload stored as JSON in PostgreSQL
- No sensitive data in job payloads
- Webhook URLs validated (if implemented)

**Queue Security:**

- Redis should be password-protected in production
- Use Redis ACLs to restrict access
- Network isolation for Redis instance

---

## Troubleshooting

### Issue: Job not enqueued

```bash
# Check Redis connection
docker exec systemvibe-redis redis-cli ping

# Check queue exists
docker exec systemvibe-redis redis-cli KEYS "bull:jobs:*"

# Check BullMQ connection in logs
docker compose logs api | grep -i bull
```

### Issue: Job status stuck in PENDING

```bash
# Check if BullMQ is properly configured
# Verify queue name matches in module registration
# Check Redis connection string in environment
```

### Issue: Permission denied on job access

```bash
# Verify JWT token is valid
# Check user ID in token matches job userId
# Ensure auth guard is applied to endpoints
```

### Issue: Prisma JSON type error

```bash
# Ensure payload is cast to 'any' for Prisma
# Check Prisma client is generated
# Run: npx prisma generate
```

---

## Next Steps (Phase 4)

You're ready for **Phase 4: Single Worker Type**:

- Image Worker service (separate Docker container)
- Image processing jobs: resize, thumbnail, compress
- Worker picks jobs from BullMQ queue
- Worker updates job status
- Error handling and failure logging
- Worker health checks

---

## Quick Reference Commands

```bash
# Submit job
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"image-resize","payload":{"url":"...","width":800,"height":600}}'

# List jobs
curl -X GET http://localhost:3000/api/jobs \
  -H "Authorization: Bearer $TOKEN"

# Get job
curl -X GET http://localhost:3000/api/jobs/<id> \
  -H "Authorization: Bearer $TOKEN"

# Cancel job
curl -X DELETE http://localhost:3000/api/jobs/<id> \
  -H "Authorization: Bearer $TOKEN"

# Check Redis queue
docker exec systemvibe-redis redis-cli KEYS "bull:jobs:*"

# Check queue length
docker exec systemvibe-redis redis-cli LLEN bull:jobs:waiting

# View Swagger docs
open http://localhost:3000/api/docs
```

---

## API Endpoints Summary

| Method | Endpoint      | Auth     | Description                 |
| ------ | ------------- | -------- | --------------------------- |
| POST   | /api/jobs     | Required | Submit new job              |
| GET    | /api/jobs     | Required | List user jobs with filters |
| GET    | /api/jobs/:id | Required | Get specific job            |
| DELETE | /api/jobs/:id | Required | Cancel job                  |

**Query Parameters (GET /api/jobs):**

- `status`: Filter by job status
- `type`: Filter by job type
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)

---

**Phase 3 Complete! 🎉**

You now have a fully functional job queue system with BullMQ and Redis. Jobs can be submitted, tracked, filtered, and cancelled. The queue is ready for workers to process jobs in Phase 4.

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';

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

// Import after mocking
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { FilterJobsDto } from './dto/filter-jobs.dto';
import { PrismaService } from '@systemvibe/database';

describe('JobsService', () => {
  let service: JobsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: getQueueToken('jobs'),
          useValue: mockQueue,
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
      const createJobDto: CreateJobDto = {
        type: 'image-resize',
        payload: { imageUrl: 'https://example.com/image.jpg', width: 800, height: 600 },
        priority: 'normal',
        timeout: 3600,
      };

      const mockJob = {
        id: 'job-id',
        type: createJobDto.type,
        userId: '00000000-0000-0000-0000-000000000000',
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

      const result = await service.create(createJobDto);

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
      const createJobDto: CreateJobDto = {
        type: 'image-resize',
        payload: { imageUrl: 'https://example.com/image.jpg' },
        priority: 'high',
      };

      const mockJob = {
        id: 'job-id',
        type: createJobDto.type,
        userId: '00000000-0000-0000-0000-000000000000',
        payload: createJobDto.payload,
        status: 'QUEUED',
        priority: 'high',
        timeout: 3600,
        createdAt: new Date(),
      };

      mockPrisma.job.create.mockResolvedValue({ ...mockJob, status: 'PENDING' });
      mockPrisma.job.update.mockResolvedValue(mockJob);
      mockQueue.add.mockResolvedValue({ id: 'job-id' });

      await service.create(createJobDto);

      expect(mockQueue.add).toHaveBeenCalledWith(
        createJobDto.type,
        expect.any(Object),
        expect.objectContaining({
          priority: 1, // High priority = 1
        })
      );
    });
  });

  describe('findOne', () => {
    it('should return a job by id', async () => {
      const jobId = 'job-id';

      const mockJob = {
        id: jobId,
        type: 'image-resize',
        userId: '00000000-0000-0000-0000-000000000000',
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

      const result = await service.findOne(jobId);

      expect(result.id).toBe(jobId);
      expect(mockPrisma.job.findUnique).toHaveBeenCalledWith({ where: { id: jobId } });
    });

    it('should throw NotFoundException if job not found', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return all jobs for a user', async () => {
      const filterDto: FilterJobsDto = {};

      const mockJobs = [
        {
          id: 'job-1',
          type: 'image-resize',
          userId: '00000000-0000-0000-0000-000000000000',
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

      const result = await service.findAll(filterDto);

      expect(result.jobs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter jobs by status', async () => {
      const filterDto: FilterJobsDto = { status: 'COMPLETED' };

      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await service.findAll(filterDto);

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'COMPLETED' },
        })
      );
    });

    it('should filter jobs by type', async () => {
      const filterDto: FilterJobsDto = { type: 'image-resize' };

      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await service.findAll(filterDto);

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: 'image-resize' },
        })
      );
    });

    it('should handle pagination', async () => {
      const filterDto: FilterJobsDto = { page: 2, limit: 10 };

      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await service.findAll(filterDto);

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );
    });
  });

  describe('cancel', () => {
    it('should cancel a job successfully', async () => {
      const jobId = 'job-id';

      const mockJob = {
        id: jobId,
        type: 'image-resize',
        userId: '00000000-0000-0000-0000-000000000000',
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

      const result = await service.cancel(jobId);

      expect(result.status).toBe('CANCELLED');
      expect(mockQueue.remove).toHaveBeenCalledWith(jobId);
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: jobId },
        data: { status: 'CANCELLED' },
      });
    });

    it('should throw NotFoundException if job not found', async () => {
      mockPrisma.job.findUnique.mockResolvedValue(null);

      await expect(service.cancel('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if job is PROCESSING', async () => {
      const mockJob = {
        id: 'job-id',
        userId: '00000000-0000-0000-0000-000000000000',
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

      await expect(service.cancel('job-id')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if job is COMPLETED', async () => {
      const mockJob = {
        id: 'job-id',
        userId: '00000000-0000-0000-0000-000000000000',
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

      await expect(service.cancel('job-id')).rejects.toThrow(BadRequestException);
    });

    it('should handle queue removal errors gracefully', async () => {
      const jobId = 'job-id';

      const mockJob = {
        id: jobId,
        type: 'image-resize',
        userId: '00000000-0000-0000-0000-000000000000',
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

      const result = await service.cancel(jobId);

      expect(result.status).toBe('CANCELLED');
      expect(mockPrisma.job.update).toHaveBeenCalled();
    });
  });
});

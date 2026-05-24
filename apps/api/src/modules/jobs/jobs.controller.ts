import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JobResponseDto } from './dto/job-response.dto';
import { FilterJobsDto } from './dto/filter-jobs.dto';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new job' })
  @ApiResponse({ status: 201, description: 'Job created successfully', type: JobResponseDto })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async create(@Body() createJobDto: CreateJobDto): Promise<JobResponseDto> {
    return this.jobsService.create(createJobDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all jobs with filtering' })
  @ApiResponse({ status: 200, description: 'Jobs retrieved successfully' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({
    name: 'priority',
    required: false,
    enum: ['low', 'normal', 'high'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(
    @Query() filterDto: FilterJobsDto
  ): Promise<{ jobs: JobResponseDto[]; total: number }> {
    return this.jobsService.findAll(filterDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific job by ID' })
  @ApiResponse({ status: 200, description: 'Job retrieved successfully', type: JobResponseDto })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async findOne(@Param('id') id: string): Promise<JobResponseDto> {
    return this.jobsService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a job' })
  @ApiResponse({ status: 200, description: 'Job cancelled successfully', type: JobResponseDto })
  @ApiResponse({ status: 400, description: 'Cannot cancel job in current status' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async cancel(@Param('id') id: string): Promise<JobResponseDto> {
    return this.jobsService.cancel(id);
  }
}

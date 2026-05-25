# Fault Tolerance in SystemVibe

This document describes the fault tolerance mechanisms and resilience strategies implemented in SystemVibe to ensure system reliability and availability.

## Overview

SystemVibe is designed with fault tolerance as a core principle. The system implements multiple layers of resilience to handle failures gracefully and maintain service availability even when components fail.

## Current Fault Tolerance Mechanisms

### 1. Job Queue Retry Logic

**Purpose**: Automatically retry failed jobs with exponential backoff to handle transient failures.

**Implementation**:
- BullMQ automatically retries failed jobs up to a configurable maximum (default: 3 attempts)
- Exponential backoff strategy: `Math.min(times * 50, 2000)` ms
- Failed jobs are moved to a delayed queue and retried automatically
- Job status tracking: `PENDING` → `ACTIVE` → `COMPLETED` / `FAILED` / `DELAYED` (for retry)

**Configuration**:
```typescript
{
  attempts: 3,              // Maximum retry attempts
  backoff: {
    type: 'exponential',
    delay: 1000,            // Initial delay in ms
  },
}
```

**Use Cases**:
- Database connection timeouts
- External API failures
- Temporary network issues
- Resource exhaustion

**Limitations**:
- Only handles transient failures
- Permanent failures will exhaust retry attempts
- No circuit breaker pattern for cascading failures

### 2. Health Check System

**Purpose**: Monitor service health and detect failures early.

**Implementation**:
- Health check endpoint: `GET /api/health`
- Checks connectivity to:
  - PostgreSQL database
  - Redis cache/queue
  - API service itself
- Returns status for each service: `healthy` / `unhealthy`

**Response Example**:
```json
{
  "status": "healthy",
  "timestamp": "2026-05-23T03:39:39.687Z",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy"
  },
  "version": "0.2.0"
}
```

**Use Cases**:
- Load balancer health checks
- Monitoring system integration
- Failure detection and alerting
- Graceful shutdown coordination

**Limitations**:
- No automatic recovery based on health status
- No circuit breaker to stop requests to unhealthy services
- Health checks are passive (no proactive healing)

### 3. Graceful Shutdown

**Purpose**: Allow services to shut down cleanly without losing data or leaving jobs in inconsistent states.

**Implementation**:
- Workers listen for `SIGTERM` and `SIGINT` signals
- On shutdown:
  - Stop accepting new jobs
  - Wait for active jobs to complete (with timeout)
  - Close Redis connections
  - Close database connections
- Docker Compose sends SIGTERM on `docker compose down`

**Worker Shutdown Flow**:
```typescript
async onApplicationShutdown() {
  await this.queue.close();
  await this.worker.close();
}
```

**Use Cases**:
- Deployments and updates
- Resource constraints
- Manual shutdowns
- Container orchestration (Kubernetes, Docker Swarm)

**Limitations**:
- No job checkpointing for long-running tasks
- Jobs interrupted during shutdown may need manual retry
- No distributed coordination for multi-worker shutdowns

### 4. Database Connection Pooling

**Purpose**: Handle database connection failures and maintain performance under load.

**Implementation**:
- Prisma connection pooling
- Automatic reconnection on connection loss
- Configurable pool size limits
- Connection timeout handling

**Configuration**:
```env
DATABASE_URL="postgresql://user:pass@host:port/db?connection_limit=10"
```

**Use Cases**:
- Database restarts
- Network interruptions
- Connection exhaustion
- High concurrency scenarios

**Limitations**:
- Pool exhaustion can still cause request failures
- No read replica failover
- No multi-region database redundancy

### 5. Redis Connection Resilience

**Purpose**: Maintain Redis connectivity for caching and job queue operations.

**Implementation**:
- ioredis automatic reconnection
- Configurable retry strategy
- Connection timeout handling
- Fallback to direct operations if cache fails

**Configuration**:
```typescript
{
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
}
```

**Use Cases**:
- Redis restarts
- Network partitions
- Temporary cache unavailability
- Queue service interruptions

**Limitations**:
- Cache misses on Redis failure (degraded performance)
- Job queue operations fail if Redis is down
- No Redis clustering for high availability

## Failure Scenarios and Current Behavior

### Scenario 1: API Service Crashes

**What happens**:
- HTTP requests fail with connection errors
- Health check returns `unhealthy`
- Nginx reverse proxy returns 502/503 errors
- Jobs in queue remain in Redis (not lost)

**Recovery**:
- Docker Compose auto-restarts the container (if configured with `restart: always`)
- Manual restart: `docker compose restart api`
- No data loss (jobs persist in Redis)

**Improvements needed**:
- Multiple API instances behind load balancer
- Circuit breaker to fail fast when API is down
- Request queuing during outages

### Scenario 2: Worker Service Crashes

**What happens**:
- Active jobs may be interrupted
- Jobs in queue remain in Redis
- No new jobs are processed
- Health check shows worker as unhealthy

**Recovery**:
- Docker Compose auto-restarts worker
- BullMQ automatically reassigns stalled jobs
- Interrupted jobs may need manual retry

**Improvements needed**:
- Multiple worker instances for redundancy
- Job checkpointing for long-running tasks
- Worker health monitoring and auto-scaling

### Scenario 3: PostgreSQL Database Fails

**What happens**:
- API cannot read/write data
- Health check returns `database: unhealthy`
- Job queue operations fail (if they require DB)
- Application errors on database operations

**Recovery**:
- Prisma attempts reconnection
- Manual database restart
- No automatic failover (single instance)

**Improvements needed**:
- PostgreSQL replication with read replicas
- Automatic failover to standby
- Connection pooling with multiple hosts
- Database clustering (Patroni, PgBouncer)

### Scenario 4: Redis Fails

**What happens**:
- Job queue operations fail
- Cache misses (degraded performance)
- Session storage fails (if using Redis sessions)
- Health check returns `redis: unhealthy`

**Recovery**:
- ioredis attempts reconnection
- Manual Redis restart
- Jobs in memory may be lost (if not persisted)

**Improvements needed**:
- Redis clustering for high availability
- Redis persistence (AOF + RDB)
- Fallback cache mechanism (in-memory)
- Queue backup to database

### Scenario 5: Network Partition

**What happens**:
- Services cannot communicate
- Partial system failures
- Inconsistent state possible
- Distributed transactions may fail

**Recovery**:
- Automatic reconnection when network restores
- Manual intervention for data reconciliation
- Job queue may have duplicate processing

**Improvements needed**:
- Idempotent job processing
- Distributed transaction coordination
- Conflict resolution strategies
- Network partition detection

## Recommended Improvements

### 1. Circuit Breaker Pattern

**Purpose**: Prevent cascading failures by stopping requests to failing services.

**Implementation**:
```typescript
// Use a circuit breaker library (e.g., opossum)
const circuit = new CircuitBreaker(asyncCall, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});
```

**Benefits**:
- Fast failure when service is down
- Prevents resource exhaustion
- Automatic recovery when service heals
- Improved user experience (fail fast)

### 2. Retry with Jitter

**Purpose**: Prevent thundering herd problem when many services retry simultaneously.

**Implementation**:
```typescript
const delay = baseDelay * Math.pow(2, attempt) + Math.random() * jitter;
```

**Benefits**:
- Distributed retry timing
- Reduced load on failing services
- Better recovery from mass failures

### 3. Bulkhead Pattern

**Purpose**: Isolate resource pools to prevent cascading failures.

**Implementation**:
- Separate connection pools for different services
- Rate limiting per service
- Resource quotas per tenant

**Benefits**:
- One service failure doesn't affect others
- Predictable resource allocation
- Better multi-tenancy support

### 4. Dead Letter Queue (DLQ)

**Purpose**: Separate permanently failed jobs for manual inspection and retry.

**Implementation**:
```typescript
// Configure BullMQ DLQ
const dlq = new Queue('jobs:dlq', { connection });
worker.on('failed', (job, error) => {
  if (job.attemptsMade >= job.opts.attempts) {
    dlq.add(job.data, { error: error.message });
  }
});
```

**Benefits**:
- Permanent failure tracking
- Manual retry capability
- Error analysis and debugging
- No job loss

### 5. Health-Based Routing

**Purpose**: Route traffic only to healthy service instances.

**Implementation**:
- Nginx health checks with passive/active monitoring
- Remove unhealthy instances from load balancer
- Gradual traffic restoration on recovery

**Benefits**:
- No requests to failing services
- Automatic traffic management
- Better user experience
- Simplified operations

### 6. Database High Availability

**Purpose**: Eliminate single point of failure in database layer.

**Implementation**:
- PostgreSQL streaming replication
- Automatic failover with Patroni
- Read replicas for query scaling
- Connection pooling with PgBouncer

**Benefits**:
- No database downtime
- Automatic failover
- Better read performance
- Geographic redundancy

### 7. Redis High Availability

**Purpose**: Eliminate single point of failure in cache/queue layer.

**Implementation**:
- Redis Cluster with multiple nodes
- Redis Sentinel for automatic failover
- Redis persistence (AOF + RDB)
- Cross-region replication

**Benefits**:
- No Redis downtime
- Automatic failover
- Data durability
- Better scalability

### 8. Distributed Tracing

**Purpose**: Track requests across services for debugging failures.

**Implementation**:
- OpenTelemetry integration
- Jaeger or Tempo for trace storage
- Correlation IDs across services
- Error context propagation

**Benefits**:
- Faster failure diagnosis
- End-to-end visibility
- Performance optimization
- Better debugging

### 9. Chaos Engineering

**Purpose**: Proactively test fault tolerance mechanisms.

**Implementation**:
- Chaos Monkey for random instance termination
- Latency injection for network issues
- Resource exhaustion testing
- Failure scenario simulations

**Benefits**:
- Validate fault tolerance
- Identify weaknesses
- Improve recovery procedures
- Build confidence in system

## Monitoring and Alerting

### Key Metrics to Monitor

**Availability**:
- Service uptime percentage
- Health check success rate
- Error rate by service

**Performance**:
- Request latency (p50, p95, p99)
- Job queue depth
- Database connection pool usage
- Redis connection count

**Reliability**:
- Job failure rate
- Retry rate by job type
- Error rate by endpoint
- Circuit breaker state changes

**Capacity**:
- CPU/memory usage per service
- Database connection count
- Redis memory usage
- Disk I/O

### Alerting Thresholds

**Critical Alerts** (immediate action):
- Service down > 1 minute
- Database connection failure
- Redis connection failure
- Error rate > 5%
- Job queue depth > 1000

**Warning Alerts** (investigate soon):
- High latency (p95 > 1s)
- High retry rate (> 10%)
- Resource usage > 80%
- Circuit breaker open

## Best Practices

### 1. Design for Failure

- Assume components will fail
- Implement graceful degradation
- Provide fallback mechanisms
- Test failure scenarios regularly

### 2. Idempotent Operations

- Design jobs to be safely retried
- Use unique identifiers for deduplication
- Implement transactional operations
- Check for existing state before processing

### 3. Timeout Configuration

- Set appropriate timeouts for all external calls
- Use exponential backoff for retries
- Implement circuit breakers for slow services
- Monitor timeout occurrences

### 4. Resource Limits

- Set memory/CPU limits for containers
- Configure connection pool sizes
- Implement rate limiting
- Monitor resource usage

### 5. Data Consistency

- Use transactions for critical operations
- Implement eventual consistency where appropriate
- Design for conflict resolution
- Regular data integrity checks

### 6. Observability

- Log all errors with context
- Use structured logging
- Implement distributed tracing
- Set up comprehensive dashboards

### 7. Testing

- Write unit tests for error handling
- Implement chaos engineering tests
- Test failure scenarios in staging
- Regularly practice disaster recovery

## Conclusion

SystemVibe has implemented foundational fault tolerance mechanisms including job retry logic, health checks, and graceful shutdown. However, to achieve production-grade resilience, additional improvements such as circuit breakers, high availability databases/Redis, and comprehensive monitoring are recommended.

Fault tolerance is an ongoing process that requires continuous improvement based on real-world failure scenarios and operational experience.

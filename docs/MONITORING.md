# Monitoring System

SystemVibe uses **Prometheus** for metrics collection and **Grafana** for visualization. This provides complete observability into job queue health, worker performance, and API metrics.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SystemVibe Monitoring                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐        │
│   │    API       │      │   Worker     │      │   Worker     │        │
│   │   Server     │      │   Image 1    │      │   Image 2    │        │
│   └──────┬───────┘      └──────┬───────┘      └──────┬───────┘        │
│          │                      │                      │                │
│          │  HTTP /metrics       │  Redis Pub/Sub       │                │
│          │                      │  job:metrics         │                │
│          ▼                      ▼                      ▼                │
│   ┌────────────────────────────────────────────────────────────┐       │
│   │                    Prometheus (Port 9090)                    │       │
│   │                                                            │       │
│   │  • Scrapes /api/metrics every 5s                          │       │
│   │  • Stores time-series data (15d retention)                │       │
│   │  • Query engine for Grafana                               │       │
│   └─────────────────────────┬──────────────────────────────────┘       │
│                             │                                            │
│                             │ HTTP (PromQL)                              │
│                             ▼                                            │
│   ┌────────────────────────────────────────────────────────────┐       │
│   │                     Grafana (Port 3001)                    │       │
│   │                                                            │       │
│   │  • Pre-built SystemVibe Dashboard                         │       │
│   │  • Real-time visualization                               │       │
│   │  • Alerting capability (future)                           │       │
│   └────────────────────────────────────────────────────────────┘       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Metrics Collection Flow

```
Job Processing → Worker → Redis Pub/Sub → API Metrics → Prometheus
     │                                        │
     │                                        │ Scrape /api/metrics
     ▼                                        ▼
┌─────────┐                         ┌──────────────────┐
│  Job    │  1. Processed           │  MetricsService  │
│Queue    │ ──────────────────────▶ │  (NestJS)        │
└─────────┘                         │                  │
     │                              │  • Job counters  │
     │ 2. Duration tracked          │  • Queue depth   │
     ▼                              │  • HTTP metrics  │
┌─────────┐                         │  • Node.js stats │
│ Worker  │  3. Publish metrics    │                  │
│Events   │ ──────────────────────▶ │  /api/metrics    │
└─────────┘    to job:metrics      │    endpoint      │
                                    └────────┬─────────┘
                                             │
                              4. Prometheus scrapes
                                             │
                                             ▼
                                    ┌──────────────────┐
                                    │   Prometheus     │
                                    │   (Time-series)  │
                                    └────────┬─────────┘
                                             │
                              5. Grafana queries
                                             │
                                             ▼
                                    ┌──────────────────┐
                                    │    Grafana       │
                                    │   (Dashboards)  │
                                    └──────────────────┘
```

### 2. Metrics Types

| Category | Metric | Type | Description |
|----------|--------|------|-------------|
| **Jobs** | `systemvibe_job_completed_total` | Counter | Jobs completed by type & priority |
| | `systemvibe_job_failed_total` | Counter | Jobs failed by type |
| | `systemvibe_job_duration_seconds` | Histogram | Processing time distribution |
| **Queue** | `systemvibe_queue_depth` | Gauge | Jobs waiting in queue |
| | `systemvibe_queue_active` | Gauge | Jobs currently processing |
| | `systemvibe_queue_delayed` | Gauge | Delayed/pending retry jobs |
| | `systemvibe_queue_failed` | Gauge | Failed jobs count |
| **Workers** | `systemvibe_worker_online` | Gauge | Active workers by type |
| | `systemvibe_worker_jobs_processed_total` | Gauge | Jobs per worker |
| **API** | `systemvibe_http_requests_total` | Counter | HTTP requests by method/route/status |
| | `systemvibe_http_request_duration_seconds` | Histogram | Response time distribution |
| **System** | `systemvibe_nodejs_*` | Various | Memory, event loop, GC metrics |

---

## Dashboard Panels

### Queue Overview
```
┌─────────────────────────────────────┐  ┌──────┐  ┌──────┐
│ Queue Depth Over Time               │  │ Jobs │  │Worker│
│                                     │  │Wait  │  │Online│
│  Waiting ████████████████████       │  │  42  │  │  3   │
│  Active  ████████                   │  │      │  │      │
│  Failed  ██                          │  │      │  │      │
│                                     │  └──────┘  └──────┘
└─────────────────────────────────────┘  ┌─────────────────┐
                                         │  Jobs by Type   │
                                         │  ┌───┐ ┌───┐    │
                                         │  │   │ │   │    │
                                         │  │Resize│Compress│
                                         │  │ 60%  │  40%   │
                                         │  └─────┘└─────┘  │
                                         └─────────────────┘
```

### Job Performance
```
┌──────────────────────────────────────┐
│ Job Processing Duration (P95, P50)     │
│                                      │
│  P95 ▲                               │
│  5s  │    ╭────╮                      │
│      │   ╱      ╲    ╭──────╮        │
│  P50 │──╱        ╲──╱        ╲────    │
│  2s  │                                 │
│      └────────────────────────────▶  │
│       10:00  10:05  10:10  10:15     │
└──────────────────────────────────────┘
```

### API Performance
```
┌──────────────────────────────────────┐
│ API Response Time (P95 by route)     │
│                                      │
│ /api/jobs    ████████  ~200ms        │
│ /api/health  ██         ~50ms         │
│ /api/metrics █████     ~150ms         │
│                                      │
└──────────────────────────────────────┘
```

---

## Data Flow

### Worker → Metrics

```
┌─────────────────────────────────────────────────────────────┐
│                     Worker Process                          │
│                                                             │
│  1. Job Start                                               │
│     ┌─────────────────────────────────────┐                  │
│     │ jobStartTimes.set(jobId, Date.now())│                  │
│     └─────────────────────────────────────┘                  │
│                                                             │
│  2. Job Complete                                            │
│     ┌─────────────────────────────────────┐                  │
│     │ duration = now - startTime         │                  │
│     │                                     │                  │
│     │ redis.publish('job:metrics', {      │                  │
│     │   event: 'job_completed',           │                  │
│     │   jobId, type, priority,           │                  │
│     │   durationSeconds: duration / 1000 │                  │
│     │ })                                  │                  │
│     └─────────────────────────────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Redis Pub/Sub
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   API Server                                │
│                                                             │
│  (Metrics stored in Prometheus registry via custom          │
│   counters/histograms - not via Redis subscription)         │
│                                                             │
│  3. Prometheus Scrapes /api/metrics                         │
│     ┌─────────────────────────────────────┐                  │
│     │ GET /api/metrics                   │                  │
│     │ returns:                           │                  │
│     │ systemvibe_job_completed_total{    │                  │
│     │   type="image-resize",             │                  │
│     │   priority="normal"                │                  │
│     │ } 42                               │                  │
│     └─────────────────────────────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Health Check Integration

The health endpoint (`/api/health`) now includes monitoring info:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00Z",
  "services": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy",
    "queue": "healthy",
    "worker": "healthy"
  },
  "details": {
    "queues": [
      {
        "name": "image",
        "waiting": 5,
        "active": 2,
        "completed": 150,
        "failed": 3,
        "delayed": 0
      }
    ],
    "workers": [
      {
        "id": "worker-image-abc123",
        "type": "image",
        "status": "active",
        "jobsProcessed": 45,
        "uptime": 3600
      }
    ],
    "metrics": {
      "endpoint": "/api/metrics",
      "format": "prometheus"
    },
    "grafana": {
      "url": "http://localhost:3001",
      "dashboard": "SystemVibe Dashboard"
    },
    "prometheus": {
      "url": "http://localhost:9090"
    }
  }
}
```

---

## Configuration Files

### Prometheus Config
```yaml
# infra/docker/prometheus.yml
scrape_configs:
  - job_name: 'systemvibe-api'
    static_configs:
      - targets: ['api:3000']
    metrics_path: /api/metrics
    scrape_interval: 5s
```

### Grafana Provisioning
```yaml
# infra/docker/grafana/provisioning/datasources/prometheus.yml
datasources:
  - name: Prometheus
    type: prometheus
    url: http://prometheus:9090
    isDefault: true
```

---

## Access URLs

| Service | URL | Credentials |
|---------|-----|-------------|
| Prometheus | http://localhost:9090 | None |
| Grafana | http://localhost:3001 | admin/admin |
| API Metrics | http://localhost:3000/api/metrics | None |
| Health Check | http://localhost:3000/api/health | None |

---

## Common Queries (PromQL)

### Job Metrics
```promql
# Jobs per minute by type
sum by (type) (rate(systemvibe_job_completed_total[1m]))

# P95 job processing time
histogram_quantile(0.95, 
  sum(rate(systemvibe_job_duration_seconds_bucket[5m])) by (le, type))

# Failed job rate
sum by (type) (rate(systemvibe_job_failed_total[5m]))
```

### Queue Metrics
```promql
# Queue depth over time
systemvibe_queue_depth

# Active jobs percentage
systemvibe_queue_active / 
  (systemvibe_queue_waiting + systemvibe_queue_active) * 100
```

### API Metrics
```promql
# Request rate by route
sum by (route) (rate(systemvibe_http_requests_total[1m]))

# Error rate percentage
sum(rate(systemvibe_http_requests_total{status_code=~"5.."}[5m])) /
sum(rate(systemvibe_http_requests_total[5m])) * 100
```

---

## Troubleshooting

### Prometheus shows "no data"
```bash
# Check API is running
curl http://localhost:3000/api/metrics

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Check logs
docker compose logs prometheus
```

### Grafana shows "No data"
```bash
# Verify Prometheus data source
curl http://localhost:9090/api/v1/query?query=up

# Check dashboard provisioning
docker compose logs grafana
```

---

## Next Steps

1. **Alerting**: Configure AlertManager for Slack/email notifications
2. **Custom Dashboards**: Create specialized dashboards for different job types
3. **Log Aggregation**: Add Loki for centralized logging
4. **Distributed Tracing**: Implement Jaeger for request tracing

# Minikube Deployment Guide

Hướng dẫn triển khai SystemVibe lên Minikube cho môi trường local development.

## Yêu cầu

- [Minikube](https://minikube.sigs.k8s.io/docs/start/) đã cài đặt
- [kubectl](https://kubernetes.io/docs/tasks/tools/) đã cài đặt
- [Docker](https://docs.docker.com/get-docker/) đã cài đặt

## Các bước triển khai

### 1. Khởi động Minikube

```bash
minikube start --driver=docker --memory=4096 --cpus=2
```

### 2. Build Docker images

```bash
# Build API image
docker build -t system-vibe-api:latest -f apps/api/Dockerfile .

# Build Worker image
docker build -t system-vibe-worker:latest -f apps/worker-image/Dockerfile .
```

### 3. Load images vào Minikube

```bash
minikube image load system-vibe-api:latest
minikube image load system-vibe-image-worker:latest
```

### 4. Triển khai lên Kubernetes

```bash
# Apply namespace
kubectl apply -f infra/k8s/namespace.yaml

# Tạo secret (sửa giá trị trong file trước khi apply)
kubectl apply -f infra/k8s/minikube/secret-example.yaml

# Triển khai database và cache
kubectl apply -f infra/k8s/minikube/postgres.yaml
kubectl apply -f infra/k8s/minikube/redis.yaml

# Triển khai ứng dụng
kubectl apply -f infra/k8s/minikube/api-deployment.yaml
kubectl apply -f infra/k8s/minikube/api-service.yaml
kubectl apply -f infra/k8s/minikube/worker-deployment.yaml
```

### 5. Chạy database migration

```bash
# Chờ PostgreSQL ready
kubectl wait --for=condition=ready pod -l app=postgres -n system-vibe --timeout=120s

# Chạy migration job
kubectl apply -f infra/k8s/minikube/prisma-migrate.yaml
```

### 6. Truy cập API

```bash
# Cách 1: Dùng minikube service
minikube service api -n system-vibe

# Cách 2: Port forward
kubectl port-forward -n system-vibe svc/api 3000:80
```

## Kiến trúc Pods và Containers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Minikube Cluster                                │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     system-vibe Namespace                        │   │
│  │                                                                  │   │
│  │  ┌─────────────────────────┐      ┌─────────────────────────┐   │   │
│  │  │      Pod: api-xxx       │      │      Pod: postgres-xxx    │   │   │
│  │  │  ┌───────────────────┐  │      │  ┌───────────────────┐    │   │   │
│  │  │  │  Container: api   │  │      │  │  Container: pg    │    │   │   │
│  │  │  │  - Image: api     │  │      │  │  - Port: 5432     │    │   │   │
│  │  │  │  - Port: 3000     │  │      │  │  - PVC: postgres  │    │   │   │
│  │  │  │  -Env: from Secret│  │      │  └───────────────────┘    │   │   │
│  │  │  │  - Probes: health │  │      │                         │   │   │
│  │  │  └───────────────────┘  │      └─────────────────────────┘   │   │   │
│  │  └─────────────────────────┘                                      │   │
│  │                              ═══════════════════════════          │   │
│  │                              │  Service: postgres:5432  │          │   │
│  │                              ═══════════════════════════          │   │
│  │  ┌─────────────────────────┐      ┌─────────────────────────┐   │   │
│  │  │    Pod: worker-xxx      │      │      Pod: redis-xxx     │   │   │
│  │  │  ┌───────────────────┐  │      │  ┌───────────────────┐    │   │   │
│  │  │  │ Container: worker │  │      │  │  Container: redis │    │   │   │
│  │  │  │  - Image: worker  │  │      │  │  - Port: 6379   │    │   │   │
│  │  │  │  -Env: from Secret│  │      │  └───────────────────┘    │   │   │
│  │  │  └───────────────────┘  │      │                           │   │   │
│  │  └─────────────────────────┘      └─────────────────────────┘   │   │
│  │                              ═══════════════════════════          │   │
│  │                              │    Service: redis:6379    │        │   │
│  │                              ═══════════════════════════          │   │
│  │  ┌─────────────────────────────────────────────────────────┐     │   │
│  │  │              Service: api (NodePort:30080)                │     │   │
│  │  │                    ↓ Port 80 → 3000                      │     │   │
│  │  │              ┌─────────────────────┐                     │     │   │
│  │  │              │  External Access   │                     │     │   │
│  │  │              │  http://NodeIP:30080│                     │     │   │
│  │  │              └─────────────────────┘                     │     │   │
│  │  └─────────────────────────────────────────────────────────┘     │   │
│  │                                                                  │   │
│  │  ┌─────────────────────────┐                                      │   │
│  │  │  Secret: system-vibe  │                                      │   │
│  │  │  - DB_USER             │                                      │   │
│  │  │  - DB_PASSWORD         │                                      │   │
│  │  │  - DB_NAME             │                                      │   │
│  │  │  - API_PORT            │                                      │   │
│  │  │  - JWT_SECRET          │                                      │   │
│  │  └─────────────────────────┘                                      │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌─────────┐     ┌──────────┐     ┌─────────────┐     ┌─────────────┐
│ Client  │────▶│  API Pod │────▶│  PostgreSQL │     │    Redis    │
│         │     │ :3000    │     │    Pod      │     │    Pod      │
└─────────┘     └────┬─────┘     └─────────────┘     └──────┬──────┘
                     │                                      │
                     │           ┌─────────────┐            │
                     └──────────▶│ Worker Pod  │◀───────────┘
                                 │ (BullMQ)    │
                                 └─────────────┘
```

## Kiểm tra trạng thái

```bash
# Xem tất cả pods
kubectl get pods -n system-vibe

# Xem logs API
kubectl logs -n system-vibe -l app=api --tail=50

# Xem logs Worker
kubectl logs -n system-vibe -l app=worker-image --tail=50

# Xem logs Database
kubectl logs -n system-vibe -l app=postgres --tail=50
```

## Dọn dẹp

```bash
# Xóa toàn bộ resources
kubectl delete namespace system-vibe

# Hoặc xóa từng resource
kubectl delete -f infra/k8s/minikube/

# Dừng minikube
minikube stop

# Xóa cluster
minikube delete
```

## Lưu ý

- Images được build local và load vào Minikube với `imagePullPolicy: Never`
- PostgreSQL và Redis chạy trong cluster (không cần Cloud SQL)
- API exposed qua NodePort trên port 30080
- Secret cần được cập nhật với giá trị thực tế trước khi apply
- **Giữ PostgreSQL và Redis ở 1 replica** để tránh database inconsistency (xem FAQ để chi tiết)

## Troubleshooting

### 1. Job creation fails with 500 error

**Symptom:**

```bash
curl -X POST http://localhost:3000/api/jobs -H "Content-Type: application/json" -d '{"type":"image-resize","payload":{"imageUrl":"https://example.com/image.jpg","width":800,"height":600}}'
# Returns: {"statusCode":500,"message":"Internal server error"}
```

**Possible causes:**

1. **Database migration chưa chạy**

   ```bash
   # Kiểm tra job migration
   kubectl get jobs -n system-vibe

   # Nếu không có job migration, chạy:
   kubectl apply -f infra/k8s/minikube/prisma-migrate.yaml
   kubectl wait --for=condition=complete job/prisma-migrate -n system-vibe --timeout=120s
   ```

2. **PostgreSQL replicas > 1 (database inconsistency)**

   ```bash
   # Kiểm tra số replicas
   kubectl get pods -n system-vibe -l app=postgres

   # Nếu > 1 pod, scale down về 1
   kubectl scale deployment postgres -n system-vibe --replicas=1
   kubectl delete job prisma-migrate -n system-vibe
   kubectl apply -f infra/k8s/minikube/prisma-migrate.yaml
   ```

3. **Redis connection error**

   ```bash
   # Kiểm tra Redis pod
   kubectl get pods -n system-vibe -l app=redis

   # Kiểm tra Redis logs
   kubectl logs -n system-vibe -l app=redis

   # Test Redis connection
   kubectl exec -n system-vibe deployment/redis -- redis-cli ping
   # Should return: PONG
   ```

### 2. API pod crash hoặc restart liên tục

**Symptom:**

```bash
kubectl get pods -n system-vibe -l app=api
# Shows: CrashLoopBackOff or RestartCount > 0
```

**Check logs:**

```bash
kubectl logs -n system-vibe -l app=api --tail=50
```

**Common issues:**

1. **Missing environment variables**

   ```bash
   # Kiểm tra secret
   kubectl get secret -n system-vibe system-vibe-secrets -o json | jq -r '.data | map_values(@base64d)'

   # Đảm bảo có: REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, DATABASE_URL
   ```

2. **Database connection failed**

   ```bash
   # Kiểm tra PostgreSQL pod
   kubectl get pods -n system-vibe -l app=postgres

   # Test PostgreSQL connection
   kubectl exec -n system-vibe deployment/postgres -- psql -U systemvibe -d systemvibe -c "SELECT 1"
   ```

### 3. Port forward bị mất

**Symptom:**

```bash
curl http://localhost:3000/api/health
# curl: (7) Failed to connect to localhost port 3000
```

**Fix:**

```bash
# Re-establish port forward
kubectl port-forward -n system-vibe svc/api 3000:80
```

**Lưu ý:** Port forward bị mất khi pods restart hoặc scale.

### 4. Images không load được vào Minikube

**Symptom:**

```bash
kubectl get pods -n system-vibe
# Shows: ImagePullBackOff or ErrImagePull
```

**Fix:**

```bash
# Build image
docker build -t system-vibe-api:latest -f apps/api/Dockerfile .

# Load vào Minikube
minikube image load system-vibe-api:latest

# Restart deployment
kubectl rollout restart deployment api -n system-vibe
```

### 5. Database migration job failed

**Symptom:**

```bash
kubectl get jobs -n system-vibe
# Shows: prisma-migrate with status 0/1 or Failed
```

**Check logs:**

```bash
kubectl logs -n system-vibe job/prisma-migrate
```

**Common issues:**

1. **PostgreSQL chưa ready**

   ```bash
   # Chờ PostgreSQL ready
   kubectl wait --for=condition=ready pod -l app=postgres -n system-vibe --timeout=120s

   # Xóa job cũ và chạy lại
   kubectl delete job prisma-migrate -n system-vibe
   kubectl apply -f infra/k8s/minikube/prisma-migrate.yaml
   ```

2. **Database connection string sai**
   ```bash
   # Kiểm tra DATABASE_URL trong secret
   kubectl get secret -n system-vibe system-vibe-secrets -o json | jq -r '.data.DATABASE_KEY' | base64 -d
   ```

## Best Practices cho Minikube

1. **Giữ stateful services ở 1 replica**
   - PostgreSQL: 1 replica
   - Redis: 1 replica
   - API/Worker: Có thể scale (stateless)

2. **Luôn chạy migration sau khi scale down PostgreSQL**

   ```bash
   kubectl scale deployment postgres -n system-vibe --replicas=1
   kubectl delete job prisma-migrate -n system-vibe
   kubectl apply -f infra/k8s/minikube/prisma-migrate.yaml
   ```

3. **Kiểm tra pod status trước khi debug**

   ```bash
   kubectl get pods -n system-vibe
   kubectl describe pod <pod-name> -n system-vibe
   ```

4. **Dùng port-forward cho local testing**

   ```bash
   kubectl port-forward -n system-vibe svc/api 3000:80
   ```

5. **Xóa và rebuild khi có thay đổi lớn**
   ```bash
   kubectl delete namespace system-vibe
   # Apply lại từ đầu
   ```

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
minikube image load system-vibe-worker:latest
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
kubectl apply -f infra/k8s/jobs/prisma-migrate.yaml
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

# Phase 7: Migration from Local Docker to GCP + Kubernetes

> A hands-on GCP learning project: from `docker compose up` to a distributed system running on the cloud with autoscaling.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [What Changes, What Stays the Same](#2-what-changes-what-stays-the-same)
3. [Step 1 — Set Up GCP](#step-1--set-up-gcp)
4. [Step 2 — Artifact Registry (replacing local Docker Hub)](#step-2--artifact-registry-replacing-local-docker-hub)
5. [Step 3 — Cloud SQL (replacing PostgreSQL container)](#step-3--cloud-sql-replacing-postgresql-container)
6. [Step 4 — Memorystore (replacing Redis container)](#step-4--memorystore-replacing-redis-container)
7. [Step 5 — GKE Cluster](#step-5--gke-cluster)
8. [Step 6 — Kubernetes Manifests](#step-6--kubernetes-manifests)
9. [Step 7 — Autoscaling (HPA + KEDA)](#step-7--autoscaling-hpa--keda)
10. [Step 8 — Ingress + Load Balancer (replacing Nginx)](#step-8--ingress--load-balancer-replacing-nginx)
11. [Step 9 — Secrets Management](#step-9--secrets-management)
12. [Step 10 — Prisma Migration in K8s](#step-10--prisma-migration-in-k8s)
13. [Step 11 — WebSocket with Multiple Pods](#step-11--websocket-with-multiple-pods)
14. [Step 12 — CI/CD Pipeline](#step-12--cicd-pipeline)
15. [Step 13 — Monitoring & Observability](#step-13--monitoring--observability)
16. [Final Directory Structure](#final-directory-structure)
17. [What You Will Learn](#what-you-will-learn)
18. [Knowledge to Master After Migration](#knowledge-to-master-after-migration)

---

## 1. Architecture Overview

### Before (Local Docker)

```
Internet → Nginx (port 80)
              ├── API (NestJS, port 3000)
              │     ├── PostgreSQL container (port 5433)
              │     └── Redis container (port 6379)
              └── Worker Image container
```

### After (GCP + Kubernetes)

```
Internet → Cloud Armor (WAF)
              → GCLB (Global Load Balancer, SSL termination)
                  → GKE Ingress
                      ├── API Deployment (2–20 pods, HPA by CPU)
                      │     ├── Cloud SQL PostgreSQL 16 (managed, HA)
                      │     └── Memorystore Redis (managed)
                      └── Worker Deployment (1–10 pods, KEDA by queue depth)
```

---

## 2. What Changes, What Stays the Same

| Component                         | Before              | After                             | Code Changes?              |
| --------------------------------- | ------------------- | --------------------------------- | -------------------------- |
| `apps/api/Dockerfile`             | Build locally       | Build → push to Artifact Registry | **No**                     |
| `apps/worker-image/Dockerfile`    | Build locally       | Build → push to Artifact Registry | **No**                     |
| NestJS source code                | Unchanged           | Unchanged                         | **No**                     |
| `infra/docker/docker-compose.yml` | Orchestrate locally | **Delete / keep for local dev**   | —                          |
| `infra/docker/nginx.conf`         | Reverse proxy       | Replaced by GKE Ingress           | **Deleted**                |
| PostgreSQL                        | Local container     | Cloud SQL                         | Change `DATABASE_URL` only |
| Redis                             | Local container     | Memorystore                       | Change `REDIS_HOST` only   |
| `.env` file                       | Used directly       | Kubernetes Secret                 | Do not push to K8s         |
| WebSocket                         | Single pod          | Needs Redis adapter (multi-pod)   | **Yes, minor**             |
| Monitoring                        | Local Grafana       | Cloud Monitoring + Grafana        | Reconfigure                |

---

## Step 1 — Set Up GCP

### Install Tools

```bash
# Google Cloud CLI
brew install google-cloud-sdk        # macOS
# or: https://cloud.google.com/sdk/docs/install

# kubectl
gcloud components install kubectl

# Helm (package manager for K8s)
brew install helm
```

### Initialize Project

```bash
gcloud auth login
gcloud projects create system-vibe-learn --name="System Vibe Learning"
gcloud config set project system-vibe-learn

# Enable required APIs
gcloud services enable \
  container.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

---

## Step 2 — Artifact Registry (replacing local Docker Hub)

Artifact Registry is where Docker images are stored on GCP, replacing local builds and runs.

```bash
# Create repository
gcloud artifacts repositories create system-vibe \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="System Vibe Docker images"

# Configure docker auth
gcloud auth configure-docker asia-southeast1-docker.pkg.dev

# Build and push API image
docker build -t asia-southeast1-docker.pkg.dev/system-vibe-learn/system-vibe/api:v1 \
  -f apps/api/Dockerfile .
docker push asia-southeast1-docker.pkg.dev/system-vibe-learn/system-vibe/api:v1

# Build and push Worker image
docker build -t asia-southeast1-docker.pkg.dev/system-vibe-learn/system-vibe/worker:v1 \
  -f apps/worker-image/Dockerfile .
docker push asia-southeast1-docker.pkg.dev/system-vibe-learn/system-vibe/worker:v1
```

> **What you learn:** Image registry, image tagging strategy (`:v1`, `:latest`, `:sha-abc123`), IAM permission for GKE to pull images.

---

## Step 3 — Cloud SQL (replacing PostgreSQL container)

```bash
# Create Cloud SQL instance (PostgreSQL 16)
gcloud sql instances create system-vibe-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \               # smallest tier, sufficient for learning
  --region=asia-southeast1 \
  --storage-auto-increase \
  --backup-start-time=02:00          # auto backup at 2am

# Create database and user
gcloud sql databases create systemvibe --instance=system-vibe-db
gcloud sql users create systemvibe \
  --instance=system-vibe-db \
  --password=your-secure-password

# Get connection name (used for Cloud SQL Proxy)
gcloud sql instances describe system-vibe-db --format="value(connectionName)"
# Output: system-vibe-learn:asia-southeast1:system-vibe-db
```

### Cloud SQL Auth Proxy in K8s (sidecar pattern)

Instead of connecting directly, the K8s pod uses the **Cloud SQL Auth Proxy** running alongside it (sidecar):

```yaml
# Add to api-deployment.yaml
spec:
  template:
    spec:
      containers:
        - name: api
          # ... api config ...
          env:
            - name: DATABASE_URL
              value: "postgresql://systemvibe:$(DB_PASSWORD)@localhost:5432/systemvibe"

        # Sidecar container
        - name: cloud-sql-proxy
          image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2
          args:
            - "--structured-logs"
            - "--port=5432"
            - "system-vibe-learn:asia-southeast1:system-vibe-db"
          resources:
            requests: { cpu: 50m, memory: 64Mi }
```

> **What you learn:** Sidecar pattern, Cloud SQL Auth Proxy, Private IP vs Public IP, connection pooling with PgBouncer.

---

## Step 4 — Memorystore (replacing Redis container)

```bash
# Create Memorystore Redis instance
gcloud redis instances create system-vibe-redis \
  --size=1 \                         # 1GB, sufficient for learning
  --region=asia-southeast1 \
  --redis-version=redis_7_0 \
  --network=default

# Get IP to fill into Secret
gcloud redis instances describe system-vibe-redis \
  --region=asia-southeast1 \
  --format="value(host)"
```

> **What you learn:** Managed cache service, VPC peering, why not expose Redis to the internet, Redis AUTH.

---

## Step 5 — GKE Cluster

```bash
# Create GKE Autopilot cluster (recommended for learning — GCP manages nodes automatically)
gcloud container clusters create-auto system-vibe-cluster \
  --region=asia-southeast1

# Or Standard cluster (manage nodes yourself, more flexible)
gcloud container clusters create system-vibe-cluster \
  --region=asia-southeast1 \
  --num-nodes=2 \
  --machine-type=e2-standard-2 \
  --enable-autoscaling \
  --min-nodes=1 \
  --max-nodes=5

# Connect kubectl to the cluster
gcloud container clusters get-credentials system-vibe-cluster \
  --region=asia-southeast1
```

> **What you learn:** Autopilot vs Standard, node pools, cluster autoscaler (scale nodes) vs HPA (scale pods).

---

## Step 6 — Kubernetes Manifests

Create the `infra/k8s/` directory with the following structure:

```
infra/k8s/
├── namespace.yaml
├── secrets.yaml          (gitignored — only used locally to apply)
├── api/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── hpa.yaml
├── worker/
│   ├── deployment.yaml
│   └── scaledobject.yaml  (KEDA)
├── ingress/
│   └── ingress.yaml
└── jobs/
    └── prisma-migrate.yaml
```

### `infra/k8s/namespace.yaml`

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: system-vibe
```

### `infra/k8s/api/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: system-vibe
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0 # zero-downtime deploy
  template:
    metadata:
      labels:
        app: api
    spec:
      serviceAccountName: system-vibe-sa # Workload Identity
      containers:
        - name: api
          image: asia-southeast1-docker.pkg.dev/system-vibe-learn/system-vibe/api:v1
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: system-vibe-secrets
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 15

        # Cloud SQL Auth Proxy sidecar
        - name: cloud-sql-proxy
          image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2
          args:
            - "--structured-logs"
            - "--port=5432"
            - "system-vibe-learn:asia-southeast1:system-vibe-db"
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
      terminationGracePeriodSeconds: 30
```

### `infra/k8s/api/service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: system-vibe
spec:
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
```

### `infra/k8s/worker/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-image
  namespace: system-vibe
spec:
  replicas: 1
  selector:
    matchLabels:
      app: worker-image
  template:
    metadata:
      labels:
        app: worker-image
    spec:
      containers:
        - name: worker
          image: asia-southeast1-docker.pkg.dev/system-vibe-learn/system-vibe/worker:v1
          envFrom:
            - secretRef:
                name: system-vibe-secrets
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "1Gi"
```

---

## Step 7 — Autoscaling (HPA + KEDA)

### HPA for API (scale by CPU)

```yaml
# infra/k8s/api/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: system-vibe
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300 # wait 5 minutes before scaling down
    scaleUp:
      stabilizationWindowSeconds: 30
```

### KEDA for Worker (scale by queue depth)

KEDA (Kubernetes Event-Driven Autoscaling) scales the worker based on the number of jobs waiting in BullMQ — this is the correct pattern for workers, since CPU usage is low when waiting for jobs but the queue can be very long.

```bash
# Install KEDA into the cluster
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda --namespace keda --create-namespace
```

```yaml
# infra/k8s/worker/scaledobject.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaledobject
  namespace: system-vibe
spec:
  scaleTargetRef:
    name: worker-image
  minReplicaCount: 0 # scale to zero when no jobs!
  maxReplicaCount: 10
  cooldownPeriod: 60 # seconds to wait before scaling down
  triggers:
    - type: redis
      metadata:
        address: "MEMORYSTORE_IP:6379"
        listName: "bull:image-processing:wait"
        listLength: "5" # 1 worker pod per 5 jobs in queue
```

> **What you learn:** The difference between HPA (metric-based) and KEDA (event-driven), scale-to-zero, why workers should scale by queue depth rather than CPU.

---

## Step 8 — Ingress + Load Balancer (replacing Nginx)

```bash
# Install nginx-ingress controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

```yaml
# infra/k8s/ingress/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: system-vibe-ingress
  namespace: system-vibe
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    # WebSocket support
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "route"
    nginx.ingress.kubernetes.io/session-cookie-expires: "172800"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "172800"
spec:
  ingressClassName: nginx
  rules:
    - host: api.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 80
```

> **What you learn:** L4 vs L7 load balancing, Ingress controller vs Ingress resource, SSL termination, WebSocket over HTTP upgrade.

---

## Step 9 — Secrets Management

**Never** commit your `.env` file to K8s or Git. There are 3 approaches:

### Option 1: kubectl Secret (simplest, good for learning)

```bash
kubectl create secret generic system-vibe-secrets \
  --namespace=system-vibe \
  --from-literal=DATABASE_URL="postgresql://systemvibe:password@localhost:5432/systemvibe" \
  --from-literal=REDIS_HOST="10.x.x.x" \
  --from-literal=REDIS_PORT="6379" \
  --from-literal=JWT_SECRET="your-jwt-secret" \
  --from-literal=JWT_REFRESH_SECRET="your-refresh-secret" \
  --from-literal=JWT_EXPIRES_IN="15m" \
  --from-literal=JWT_REFRESH_EXPIRES_IN="7d" \
  --from-literal=NODE_ENV="production"
```

### Option 2: GCP Secret Manager + External Secrets Operator (production)

```bash
# Store secret in GCP Secret Manager
echo -n "your-jwt-secret" | \
  gcloud secrets create jwt-secret --data-file=-

# Install External Secrets Operator
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace
```

```yaml
# Auto-sync from GCP Secret Manager into K8s Secret
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: system-vibe-secrets
  namespace: system-vibe
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: gcp-secret-store
    kind: SecretStore
  target:
    name: system-vibe-secrets
  data:
    - secretKey: JWT_SECRET
      remoteRef:
        key: jwt-secret
```

> **What you learn:** Secret rotation, RBAC in K8s, Workload Identity (pods don't need service account key files), why ConfigMap should not be used for sensitive data.

---

## Step 10 — Prisma Migration in K8s

Each time a new version with schema changes is deployed, run the migration as a K8s Job:

```yaml
# infra/k8s/jobs/prisma-migrate.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: prisma-migrate-v1
  namespace: system-vibe
spec:
  ttlSecondsAfterFinished: 3600 # auto-delete Job after 1 hour
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: asia-southeast1-docker.pkg.dev/system-vibe-learn/system-vibe/api:v1
          command: ["npx", "prisma", "migrate", "deploy"]
          envFrom:
            - secretRef:
                name: system-vibe-secrets

        - name: cloud-sql-proxy
          image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2
          args:
            - "--structured-logs"
            - "--port=5432"
            - "system-vibe-learn:asia-southeast1:system-vibe-db"
```

```bash
kubectl apply -f infra/k8s/jobs/prisma-migrate.yaml
kubectl wait --for=condition=complete job/prisma-migrate-v1 -n system-vibe
```

---

## Step 11 — WebSocket with Multiple Pods

The project uses Socket.IO with Redis Pub/Sub. When running multiple API pods, a Redis adapter is needed so that events from one pod are broadcast to all clients even if they are connected to a different pod.

### Check Existing Code

The file `apps/api/src/modules/websocket/` already uses Redis Pub/Sub for worker-to-API communication. You need to add the Socket.IO Redis adapter:

```bash
cd apps/api
npm install @socket.io/redis-adapter
```

```typescript
// apps/api/src/modules/websocket/websocket.gateway.ts
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

// In AppModule or WebsocketModule
const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

io.adapter(createAdapter(pubClient, subClient));
```

> **What you learn:** Stateful vs stateless services, why REST APIs are easier to scale than WebSocket, sticky session vs shared state.

---

## Step 12 — CI/CD Pipeline

```yaml
# .github/workflows/deploy.yaml
name: Deploy to GKE

on:
  push:
    branches: [main]

env:
  PROJECT_ID: system-vibe-learn
  REGION: asia-southeast1
  CLUSTER: system-vibe-cluster
  REGISTRY: asia-southeast1-docker.pkg.dev

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # Workload Identity Federation

    steps:
      - uses: actions/checkout@v4

      - name: Auth GCP
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Setup gcloud
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.REGISTRY }}

      - name: Build & Push API
        run: |
          IMAGE=${{ env.REGISTRY }}/${{ env.PROJECT_ID }}/system-vibe/api:${{ github.sha }}
          docker build -t $IMAGE -f apps/api/Dockerfile .
          docker push $IMAGE

      - name: Build & Push Worker
        run: |
          IMAGE=${{ env.REGISTRY }}/${{ env.PROJECT_ID }}/system-vibe/worker:${{ github.sha }}
          docker build -t $IMAGE -f apps/worker-image/Dockerfile .
          docker push $IMAGE

      - name: Get GKE credentials
        run: |
          gcloud container clusters get-credentials ${{ env.CLUSTER }} \
            --region ${{ env.REGION }}

      - name: Run Prisma Migrations
        run: |
          # Replace image tag and apply migration job
          sed "s|:v1|:${{ github.sha }}|g" infra/k8s/jobs/prisma-migrate.yaml | \
            kubectl apply -f -
          kubectl wait --for=condition=complete \
            job/prisma-migrate -n system-vibe --timeout=120s

      - name: Deploy API
        run: |
          kubectl set image deployment/api \
            api=${{ env.REGISTRY }}/${{ env.PROJECT_ID }}/system-vibe/api:${{ github.sha }} \
            -n system-vibe
          kubectl rollout status deployment/api -n system-vibe

      - name: Deploy Worker
        run: |
          kubectl set image deployment/worker-image \
            worker=${{ env.REGISTRY }}/${{ env.PROJECT_ID }}/system-vibe/worker:${{ github.sha }} \
            -n system-vibe
          kubectl rollout status deployment/worker-image -n system-vibe
```

> **What you learn:** Workload Identity Federation (no service account key files), rolling deployment, rollback with `kubectl rollout undo`.

---

## Step 8 — Ingress + Load Balancer (Replacing Nginx)

Local development uses Nginx. On GKE, use **GKE Ingress** with Cloud Load Balancer.

```bash
# 1. Reserve static IP
gcloud compute addresses create system-vibe-ip --global
export STATIC_IP=$(gcloud compute addresses describe system-vibe-ip --global --format='value(address)')
echo "IP: $STATIC_IP  # Add to DNS A record"
```

```yaml
# infra/k8s/ingress/certificate.yaml
apiVersion: networking.gke.io/v1
kind: ManagedCertificate
metadata:
  name: system-vibe-cert
  namespace: system-vibe
spec:
  domains:
    - api.systemvibe.com
```

```yaml
# infra/k8s/ingress/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: system-vibe
  annotations:
    kubernetes.io/ingress.class: "gce"
    kubernetes.io/ingress.global-static-ip-name: "system-vibe-ip"
    networking.gke.io/managed-certificates: "system-vibe-cert"
    kubernetes.io/ingress.allow-http: "false"
spec:
  rules:
    - host: api.systemvibe.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 80
```

```bash
kubectl apply -f infra/k8s/ingress/
kubectl get managedcertificate -n system-vibe -w  # Wait 5-15 min
```

**Features:**

- Google-managed SSL (auto-renew)
- Global load balancing
- DDoS protection
- HTTPS redirect

---

## Step 13 — Monitoring & Observability

The project already exposes Prometheus metrics (`apps/api/src/modules/metrics/`). On GKE, you have 2 options:

### Option 1 — Self-Hosted (kube-prometheus-stack)

Full control, run Prometheus + Grafana in your cluster:

```bash
# Install kube-prometheus-stack (Prometheus + Grafana + Alertmanager)
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --set grafana.adminPassword=your-password
```

```yaml
# ServiceMonitor to scrape metrics from API pods
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api-monitor
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: api
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

### Option 2 — Google Managed Prometheus (GMP) + Cloud Monitoring ⭐ Recommended

Zero infrastructure management, auto-scaling storage:

```bash
# Enable GMP on your cluster
gcloud container clusters update system-vibe-cluster \
  --enable-managed-prometheus \
  --region=asia-southeast1

# Deploy collectors
kubectl apply -f https://raw.githubusercontent.com/GoogleCloudPlatform/prometheus-engine/main/manifests/setup.yaml
```

```yaml
# PodMonitoring to scrape metrics from API pods
apiVersion: monitoring.googleapis.com/v1
kind: PodMonitoring
metadata:
  name: api-metrics
  namespace: system-vibe
spec:
  selector:
    matchLabels:
      app: api
  endpoints:
    - port: 3000
      path: /metrics
      interval: 15s
```

**Access dashboards:**

- Go to [Cloud Monitoring → Dashboards](https://console.cloud.google.com/monitoring/dashboards)
- Create custom dashboards or import the provided `infra/k8s/monitoring/dashboard.json`

**Comparison:**

| Feature           | Self-Hosted        | Google Managed Prometheus                   |
| ----------------- | ------------------ | ------------------------------------------- |
| Server management | You manage pods    | Fully managed                               |
| Storage           | Manual PVC sizing  | Auto-scaling                                |
| Retention         | Configure manually | 15 days default                             |
| Grafana           | Included           | Use Cloud Monitoring or self-hosted Grafana |
| Cost              | GKE resources      | Per-sample ingestion                        |

> **Recommendation:** Start with GMP for simplicity. Switch to self-hosted if you need long retention or advanced Grafana features.

---

## Final Directory Structure

```
system-vibe/
├── apps/
│   ├── api/
│   │   └── Dockerfile              ← UNCHANGED
│   └── worker-image/
│       └── Dockerfile              ← UNCHANGED
├── infra/
│   ├── docker/                     ← Keep for local dev
│   │   ├── docker-compose.yml
│   │   └── nginx.conf
│   └── k8s/                        ← NEW
│       ├── namespace.yaml
│       ├── api/
│       │   ├── deployment.yaml
│       │   ├── service.yaml
│       │   └── hpa.yaml
│       ├── worker/
│       │   ├── deployment.yaml
│       │   └── scaledobject.yaml
│       ├── ingress/
│       │   └── ingress.yaml
│       ├── jobs/
│       │   └── prisma-migrate.yaml
│       └── monitoring/               ← NEW (GMP + Dashboards)
│           ├── podmonitoring.yaml
│           ├── dashboard.json
│           └── alerting-policy.yaml
└── .github/
    └── workflows/
        └── deploy.yaml             ← NEW
```

---

## What You Will Learn

### GCP Services

| Service                       | What You Learn                                                         |
| ----------------------------- | ---------------------------------------------------------------------- |
| **Artifact Registry**         | Image registry, tagging strategy, IAM pull permission                  |
| **Cloud SQL**                 | Managed database, HA setup, Cloud SQL Auth Proxy, connection pooling   |
| **Memorystore**               | Managed Redis, VPC networking, why not expose Redis externally         |
| **GKE**                       | Autopilot vs Standard, node pool, cluster autoscaler                   |
| **Cloud Load Balancer**       | L4/L7, SSL termination, health check                                   |
| **Secret Manager**            | Secret rotation, versioning, audit log                                 |
| **Cloud Monitoring**          | Metrics, logs, alerting, dashboards                                    |
| **Google Managed Prometheus** | Managed Prometheus, auto-scaling storage, Cloud Monitoring integration |
| **IAM + Workload Identity**   | Principle of least privilege, no service account key files             |
| **VPC & Private IP**          | Network isolation, private services                                    |

### Kubernetes Concepts

| Concept                        | Application in This Project                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| **Pod**                        | Smallest unit; API + cloud-sql-proxy run in the same pod (sidecar) |
| **Deployment**                 | Manage replicas, rolling updates, rollbacks                        |
| **Service**                    | ClusterIP for internal, LoadBalancer for external                  |
| **Ingress**                    | L7 routing, host-based, WebSocket support                          |
| **HPA**                        | Scale API by CPU/memory                                            |
| **KEDA ScaledObject**          | Scale worker by queue depth                                        |
| **Job**                        | Run prisma migrate once and finish                                 |
| **Secret**                     | Store credentials, no hardcoding                                   |
| **ConfigMap**                  | Store non-sensitive configuration                                  |
| **Namespace**                  | Resource isolation, RBAC boundary                                  |
| **ServiceAccount**             | Pod identity, used with Workload Identity                          |
| **PodDisruptionBudget**        | Ensure at least N pods are running during node drain               |
| **ResourceRequest/Limit**      | Prevent pods from consuming all node resources                     |
| **Probe (liveness/readiness)** | Let K8s know which pods are healthy to route traffic               |
| **PodMonitoring**              | GMP resource to scrape Prometheus metrics from pods                |

### System Design Patterns

| Pattern                      | Where You Learn It                                         |
| ---------------------------- | ---------------------------------------------------------- |
| **Sidecar pattern**          | Cloud SQL Auth Proxy running alongside the API pod         |
| **Scale-to-zero**            | KEDA scales the worker to 0 when the queue is empty        |
| **Event-driven autoscaling** | KEDA scales based on BullMQ job count                      |
| **Rolling deployment**       | Zero-downtime when deploying a new version                 |
| **Stateless service**        | API stores no state, free to scale                         |
| **Stateful vs stateless**    | WebSocket needs sticky sessions or a Redis adapter         |
| **Health check**             | How readiness and liveness probes differ                   |
| **Graceful shutdown**        | Pod receives SIGTERM, drains requests before shutting down |

---

## Knowledge to Master After Migration

After completing the migration, you should be able to answer the following questions:

### Kubernetes

- What are the differences between `Deployment`, `StatefulSet`, `DaemonSet`, `Job`, and `CronJob`? When should each be used?
- Do pods have their own IP? Does the IP change when a pod restarts? What problem does Service solve?
- How do `readinessProbe` and `livenessProbe` differ? What happens during a deploy if readinessProbe is missing?
- What does HPA scale on? Why should workers use KEDA instead of HPA?
- What does `RollingUpdate` with `maxSurge=1, maxUnavailable=0` mean? What command is used to roll back?
- Why are `resources.requests` and `resources.limits` needed? What happens if they are not set?
- What does `PodDisruptionBudget` protect? When is it necessary?
- What does a Namespace mean in terms of network isolation?

### GCP & Cloud

- How does Cloud SQL Auth Proxy work? Why not connect directly via Public IP?
- What is Workload Identity? Why is it better than using a service account key file?
- What is the difference between Cluster Autoscaler (scale nodes) and HPA (scale pods)?
- Does Memorystore Redis support persistence? If the instance restarts, is data lost?
- How does GCLB (Global Load Balancer) differ from a regional load balancer?

### Distributed Systems

- When the API has 10 pods and a client connects via WebSocket to pod #3, if pod #3 crashes, can the client receive events from pod #7? How do you fix this?
- Do multiple worker pods running in parallel with BullMQ cause race conditions? How does BullMQ handle this?
- When should Prisma migrations run in the deploy pipeline? If a migration fails, is rolling back the app code safe?
- How does graceful shutdown work in NestJS? What should a pod do before shutting down after receiving SIGTERM?
- Why is `terminationGracePeriodSeconds` important for an API handling long-running requests?

### Security

- Why should secrets not be stored in ConfigMap? Are K8s Secrets truly "secure"?
- How does the Principle of Least Privilege apply to GCP IAM and K8s RBAC?
- Why should Redis and PostgreSQL run in a private VPC and not be exposed to the internet?
- How does JWT secret rotation affect currently logged-in users? How should this be handled?

---

## Recommended Next Steps After This Project

After completing the migration, you will have a solid foundation to continue learning:

1. **Service Mesh (Istio/Linkerd)** — mTLS between services, traffic management, advanced observability
2. **GitOps with ArgoCD** — K8s manifests auto-synced from Git, no manual `kubectl apply`
3. **Multi-cluster & Multi-region** — running clusters across multiple regions, global load balancing
4. **Chaos Engineering** — using Chaos Monkey or Litmus to test fault tolerance
5. **FinOps** — optimizing GCP costs: Spot VMs, committed use discounts, right-sizing

---

_This guide was created for the [system-vibe](https://github.com/satoshiman/system-vibe) project — a hands-on system design learning platform._

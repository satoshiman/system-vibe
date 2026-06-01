# GCP Setup Guide — System Vibe Migration

> Step-by-step GCP setup guide for migrating from Docker Compose to GKE.

---

## Prerequisites

**Status:** ✅ Completed

- kubectl v1.35.3 installed
- helm v4.2.0 installed

```bash
# Google Cloud CLI
brew install google-cloud-sdk        # macOS
# or: https://cloud.google.com/sdk/docs/install

# kubectl
gcloud components install kubectl

# Helm (package manager for K8s)
brew install helm
```

---

## Step 1 — Set Up GCP Project

### 1.1 Login and set project

```bash
gcloud auth login
gcloud config set project system-vibe
```

### 1.2 Enable required APIs

```bash
gcloud services enable \
  container.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudresourcemanager.googleapis.com
```

**Status:** ✅ Completed

---

## Step 2 — Artifact Registry (Image Storage)

> Artifact Registry stores Docker images on GCP, replacing local builds.

```bash
# 2.1 Create repository
gcloud artifacts repositories create system-vibe \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="System Vibe Docker images"

# 2.2 Auth Docker with GCP
gcloud auth configure-docker asia-southeast1-docker.pkg.dev

# 2.3 Build & push API image
docker build -t asia-southeast1-docker.pkg.dev/system-vibe/system-vibe/api:v1 \
  -f apps/api/Dockerfile .
docker push asia-southeast1-docker.pkg.dev/system-vibe/system-vibe/api:v1

# 2.4 Build & push Worker image
docker build -t asia-southeast1-docker.pkg.dev/system-vibe/system-vibe/worker:v1 \
  -f apps/worker-image/Dockerfile .
docker push asia-southeast1-docker.pkg.dev/system-vibe/system-vibe/worker:v1
```

**Status:** ⏳ Not started

---

## Step 3 — Cloud SQL (PostgreSQL)

> Replace PostgreSQL container with Cloud SQL managed service.

```bash
# 3.1 Create PostgreSQL instance
gcloud sql instances create system-vibe-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=asia-southeast1 \
  --storage-auto-increase \
  --backup-start-time=02:00

# 3.2 Create database and user
gcloud sql databases create systemvibe --instance=system-vibe-db
gcloud sql users create systemvibe \
  --instance=system-vibe-db \
  --password=your-secure-password-123

# 3.3 Get connection name (needed for K8s)
gcloud sql instances describe system-vibe-db --format="value(connectionName)"
# Example output: system-vibe:asia-southeast1:system-vibe-db
```

**Status:** ⏳ Not started

---

## Step 4 — Memorystore (Redis)

> Replace Redis container with Memorystore managed service.

```bash
# 4.1 Create Redis instance
gcloud redis instances create system-vibe-redis \
  --size=1 \
  --region=asia-southeast1 \
  --redis-version=redis_7_0 \
  --network=default

# 4.2 Get Redis IP (needed for K8s Secret)
gcloud redis instances describe system-vibe-redis \
  --region=asia-southeast1 \
  --format="value(host)"
# Example output: 10.148.0.3
```

**Status:** ⏳ Not started

---

## Step 5 — GKE Cluster

> Create Kubernetes cluster to run API and Worker.

```bash
# 5.1 Create Autopilot cluster (recommended for learning)
gcloud container clusters create-auto system-vibe-cluster \
  --region=asia-southeast1

# 5.2 Connect kubectl
gcloud container clusters get-credentials system-vibe-cluster \
  --region=asia-southeast1

# 5.3 Verify
kubectl get nodes
```

**Status:** ⏳ Not started

---

## Step 6 — Kubernetes Manifests

> Create K8s manifests in `infra/k8s/`. See details at [GCP_K8S_MIGRATION_GUIDE.md](./implementation/GCP_K8S_MIGRATION_GUIDE.md).

**Status:** ⏳ Not started

---

## Step 7 — Secrets Management

> Create Kubernetes Secret containing environment variables.

```bash
# Create secret from command line (do not commit to git)
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

**Status:** ⏳ Not started

---

## Progress Checklist

- [x] Step 1 — Set Up GCP Project
- [ ] Step 2 — Artifact Registry
- [ ] Step 3 — Cloud SQL
- [ ] Step 4 — Memorystore
- [ ] Step 5 — GKE Cluster
- [ ] Step 6 — Kubernetes Manifests
- [ ] Step 7 — Secrets Management
- [ ] Step 8 — Deploy and Verify

---

## Useful Commands

```bash
# View current project
gcloud config get project

# List enabled services
gcloud services list --enabled

# View Artifact Registry repositories
gcloud artifacts repositories list

# View Cloud SQL instances
gcloud sql instances list

# View Memorystore instances
gcloud redis instances list --region=asia-southeast1

# View GKE clusters
gcloud container clusters list
```

---

_Note: Do not commit this file if it contains sensitive information._

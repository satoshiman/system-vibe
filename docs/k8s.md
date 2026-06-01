# Kubernetes Deployment Troubleshooting Guide

## Common Issues and Solutions

### 1. Environment Variable Mismatch: `API_PORT` vs `PORT`

**Symptom:**
```
RangeError: options.port should be >= 0 and < 65536. Received type number (NaN).
```

**Root Cause:**
The Kubernetes secret had `PORT=3000` but the application config expected `API_PORT`.

**Fix:**
Patch the secret to add the correct variable:
```bash
kubectl patch secret -n system-vibe system-vibe-secrets --type='json' \
  -p='[{"op": "add", "path": "/data/API_PORT", "value": "MzAwMA=="}]'
```

**Prevention:**
Ensure `.env.example` and Kubernetes secrets are in sync. The config expects:
```env
API_PORT=3000
```

---

### 2. Prisma Binary Target Mismatch on Alpine Linux

**Symptom:**
```
PrismaClientInitializationError: Prisma Client could not locate the Query Engine 
for runtime "linux-musl-openssl-3.0.x".

This happened because Prisma Client was generated for "linux-musl", 
but the actual deployment required "linux-musl-openssl-3.0.x".
```

**Root Cause:**
Worker image uses `node:20-alpine` (musl-based), but Prisma client was generated without the correct binary target.

**Fix:**
Update `packages/database/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
  binaryTargets = [
    "native", 
    "linux-arm64-openssl-3.0.x", 
    "debian-openssl-3.0.x", 
    "linux-musl-openssl-3.0.x"  // Required for Alpine
  ]
}
```

Then regenerate Prisma client during build:
```bash
npx prisma generate --schema=packages/database/prisma/schema.prisma
```

---

### 3. Missing OpenSSL Libraries in Alpine Runtime

**Symptom:**
```
Prisma connection failed: Error loading shared library libssl.so.1.1: 
No such file or directory (needed by libquery_engine-linux-musl.so.node)
```

**Root Cause:**
Alpine Linux runtime stage missing required SSL libraries for Prisma.

**Fix:**
Update `apps/worker-image/Dockerfile` runtime stage:
```dockerfile
FROM node:20-alpine

# Install runtime dependencies for Sharp and Prisma
RUN apk add --no-cache vips-dev openssl libssl3
```

---

### 4. Platform Architecture Mismatch (ARM64 → AMD64)

**Symptom:**
```
exec /usr/local/bin/docker-entrypoint.sh: exec format error
```

**Root Cause:**
Building on Mac ARM64 (Apple Silicon) but deploying to GKE AMD64 nodes.

**Fix:**
Build with explicit platform targeting:
```bash
docker build --platform linux/amd64 \
  -f apps/worker-image/Dockerfile \
  -t asia-southeast1-docker.pkg.dev/system-vibe/system-vibe/worker:v7 .
```

---

### 5. Missing Cloud SQL Proxy Sidecar

**Symptom:**
```
Prisma connection failed: Can't reach database server at `localhost:5432`
```

**Root Cause:**
Worker deployment missing the Cloud SQL Proxy sidecar that API deployment had.

**Fix:**
Add sidecar container to `infra/k8s/worker/deployment.yaml`:
```yaml
containers:
  - name: worker
    # ... worker container config
    
  - name: cloud-sql-proxy
    image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2
    args:
      - "--structured-logs"
      - "--port=5432"
      - "system-vibe:asia-southeast1:system-vibe-db"
    resources:
      requests:
        cpu: "50m"
        memory: "64Mi"
```

---

## Deployment Checklist

Before deploying to K8s:

- [ ] Verify all environment variables in secret match `.env.example`
- [ ] Build images with correct platform (`linux/amd64` for GKE)
- [ ] Include all Prisma binary targets for your base image
- [ ] Add required runtime libraries (openssl, libssl3 for Alpine)
- [ ] Ensure Cloud SQL Proxy sidecar is present for database connectivity
- [ ] Test locally with `docker run` before pushing to registry

## Useful Commands

```bash
# Check pod status
kubectl get pods -n system-vibe

# View logs
kubectl logs -n system-vibe <pod-name> --tail=50

# View previous container logs (after crash)
kubectl logs -n system-vibe <pod-name> --previous

# Restart deployment
kubectl rollout restart deployment -n system-vibe <deployment-name>

# Port forward for local testing
kubectl port-forward -n system-vibe svc/api 3000:80

# Check secret values (decoded)
kubectl get secret -n system-vibe system-vibe-secrets -o json | \
  jq -r '.data | map_values(@base64d)'
```

## Architecture Reference

```
┌─────────────────────────────────────┐
│           GKE Cluster               │
│                                     │
│  ┌─────────────────────────────┐  │
│  │      API Deployment         │  │
│  │  ┌─────────────────────┐   │  │
│  │  │  API Container      │   │  │
│  │  │  (Port 3000)        │   │  │
│  │  └─────────────────────┘   │  │
│  │  ┌─────────────────────┐   │  │
│  │  │ Cloud SQL Proxy     │   │  │
│  │  │ (Port 5432)         │   │  │
│  │  └─────────────────────┘   │  │
│  └─────────────────────────────┘  │
│                                     │
│  ┌─────────────────────────────┐  │
│  │    Worker Deployment        │  │
│  │  ┌─────────────────────┐   │  │
│  │  │  Worker Container   │   │  │
│  │  │  (BullMQ Processor) │   │  │
│  │  └─────────────────────┘   │  │
│  │  ┌─────────────────────┐   │  │
│  │  │ Cloud SQL Proxy     │   │  │
│  │  │ (Port 5432)         │   │  │
│  │  └─────────────────────┘   │  │
│  └─────────────────────────────┘  │
│                                     │
└─────────────────────────────────────┘
```

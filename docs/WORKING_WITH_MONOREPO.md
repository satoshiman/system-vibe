# Working with Monorepo - Complete Guide

**Target Audience**: Developers transitioning from traditional single-package repositories to monorepos

---

## Table of Contents

1. [What is a Monorepo?](#what-is-a-monorepo)
2. [Traditional Repo vs Monorepo](#traditional-repo-vs-monorepo)
3. [npm Workspaces Explained](#npm-workspaces-explained)
4. [Project Structure](#project-structure)
5. [Dependency Management](#dependency-management)
6. [Script Management](#script-management)
7. [Common Commands](#common-commands)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)
10. [SystemVibe Examples](#systemvibe-examples)

---

## What is a Monorepo?

**Definition**: A monorepo (monolithic repository) is a version control strategy where multiple projects/packages are stored in a single repository.

**Key Characteristics:**
- Multiple packages/apps in one Git repository
- Shared dependencies and tooling
- Unified version control
- Atomic commits across packages

**Real-world examples:**
- Google (all code in one monorepo)
- Facebook/Meta
- Microsoft
- React (packages in one repo)
- Babel

---

## Traditional Repo vs Monorepo

### Traditional Repository (Single Package)

```
my-project/
├── package.json          # Single package
├── src/
├── node_modules/
└── .gitignore
```

**Characteristics:**
- One `package.json`
- One set of dependencies
- One build process
- Simple to understand
- Hard to share code between projects

### Monorepo (Multiple Packages)

```
my-monorepo/
├── package.json          # Root package (workspaces config)
├── apps/
│   ├── api/              # Deployable app
│   │   ├── package.json
│   │   └── src/
│   └── web/              # Another app
│       ├── package.json
│       └── src/
├── packages/
│   ├── shared/           # Shared library
│   │   ├── package.json
│   │   └── src/
│   └── database/         # Shared database client
│       ├── package.json
│       └── src/
└── node_modules/         # Hoisted dependencies
```

**Characteristics:**
- Multiple `package.json` files
- Dependencies can be shared
- Each package can be built independently
- More complex but more powerful

---

## npm Workspaces Explained

### What are npm Workspaces?

npm Workspaces is a built-in feature (npm 7+) that manages monorepo dependencies automatically.

**How it works:**
1. Root `package.json` defines workspaces
2. npm automatically links local packages
3. Dependencies are "hoisted" to root `node_modules`
4. Scripts can run across all workspaces

### Configuration

```json
// Root package.json
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

**What this tells npm:**
- Look in `apps/` directory for workspaces
- Look in `packages/` directory for workspaces
- `*` is a wildcard matching any folder name

---

## Project Structure

### SystemVibe Structure

```
systemvibe/
├── package.json              # Root (workspaces config)
├── apps/
│   └── api/                  # NestJS API server
│       ├── package.json      # API dependencies
│       ├── src/
│       └── dist/
├── packages/
│   ├── database/             # Prisma ORM
│   │   ├── package.json
│   │   ├── prisma/
│   │   └── migrations/
│   ├── redis/                # Redis utilities
│   │   ├── package.json
│   │   └── src/
│   └── shared/               # Shared types/utils
│       ├── package.json
│       └── src/
├── infra/
│   └── docker/
│       ├── docker-compose.yml
│       └── nginx.conf
└── docs/
```

### Why This Structure?

**apps/** - Deployable applications
- `apps/api/` - Main API server
- Future: `apps/worker/`, `apps/webhook/`, etc.
- Each app can be deployed independently

**packages/** - Shared libraries
- `packages/database/` - Database client used by all apps
- `packages/redis/` - Redis utilities used by all apps
- `packages/shared/` - Common types and utilities
- Code reuse across apps

**infra/** - Infrastructure
- Docker configurations
- Deployment scripts
- Not part of the build process

---

## Dependency Management

### Types of Dependencies

#### 1. Regular Dependencies (External)

```json
// apps/api/package.json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",  // External package
    "bcrypt": "^6.0.0"            // External package
  }
}
```

**Behavior:**
- Installed in root `node_modules` (hoisting)
- Available to all workspaces
- Same version used across project

#### 2. Workspace Dependencies (Internal)

```json
// apps/api/package.json
{
  "dependencies": {
    "@systemvibe/database": "^0.1.0",  // Local package
    "@systemvibe/redis": "^0.1.0"       // Local package
  }
}
```

**Behavior:**
- npm creates symlink from `node_modules/@systemvibe/database` → `packages/database`
- Changes in `packages/database` immediately available to `apps/api`
- No need to publish to npm registry

#### 3. Dev Dependencies

```json
// apps/api/package.json
{
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Behavior:**
- Only needed for development
- Not installed in production
- Hoisted to root `node_modules`

### Installing Dependencies

#### Install for Specific Workspace

```bash
# From root
npm install --workspace=apps/api bcrypt

# Or short form
npm install -w apps/api bcrypt
```

**What happens:**
1. `bcrypt` added to `apps/api/package.json`
2. `bcrypt` installed in root `node_modules`
3. If `bcrypt` already exists, no re-install

#### Install for All Workspaces

```bash
# From root
npm install
```

**What happens:**
1. Reads all workspace `package.json` files
2. Installs all dependencies
3. Hoists common dependencies to root
4. Creates symlinks for workspace dependencies

#### Install New Workspace Dependency

```bash
# Add local package as dependency
npm install --workspace=apps/api @systemvibe/database
```

**What happens:**
1. Adds to `apps/api/package.json`
2. Creates symlink to `packages/database`
3. No npm registry download needed

### Dependency Hoisting

**Before hoisting (traditional):**
```
apps/api/node_modules/bcrypt/
apps/api/node_modules/@nestjs/common/
packages/database/node_modules/bcrypt/  # Duplicate!
packages/database/node_modules/@nestjs/common/  # Duplicate!
```

**After hoisting (workspaces):**
```
node_modules/bcrypt/              # Single copy
node_modules/@nestjs/common/     # Single copy
apps/api/node_modules/@systemvibe/database -> ../../packages/database
packages/database/node_modules/@systemvibe/redis -> ../../packages/redis
```

**Benefits:**
- Less disk space
- Faster install times
- Consistent versions across project

---

## Script Management

### Workspace Scripts

Each workspace has its own scripts:

```json
// apps/api/package.json
{
  "scripts": {
    "start": "node dist/main",
    "dev": "nest start --watch",
    "build": "nest build"
  }
}
```

**Running workspace script from root:**

```bash
# Option 1: Use --workspace flag
npm run dev --workspace=apps/api

# Option 2: Navigate to workspace
cd apps/api
npm run dev
```

### Root Scripts (All Workspaces)

```json
// Root package.json
{
  "scripts": {
    "dev": "npm run dev --ws",
    "build": "npm run build --ws",
    "test": "npm run test --ws"
  }
}
```

**Running from root:**

```bash
npm run build
```

**What happens:**
1. Finds all workspaces
2. Runs `npm run build` in each workspace
3. Reports results for each

**Output example:**
```
> systemvibe@0.1.0 build
> npm run build --ws

> @systemvibe/database@0.1.0 build
> tsc

> @systemvibe/redis@0.1.0 build
> tsc

> systemvibe-api@0.1.0 build
> nest build
```

### Selective Workspace Execution

```bash
# Run build only for specific workspaces
npm run build --workspace=apps/api --workspace=packages/database

# Or use --if-present to skip workspaces without the script
npm run build --ws --if-present
```

---

## Common Commands

### Installation Commands

```bash
# Install all dependencies (all workspaces)
npm install

# Install for specific workspace
npm install --workspace=apps/api <package>

# Install dev dependency for specific workspace
npm install --workspace=apps/api -D <package>

# Install local package as dependency
npm install --workspace=apps/api @systemvibe/database
```

### Script Commands

```bash
# Run script in specific workspace
npm run <script> --workspace=<workspace>

# Run script in all workspaces
npm run <script> --ws

# Run script with workspace flag
npm run -w <workspace> <script>
```

### Build Commands

```bash
# Build all workspaces
npm run build

# Build specific workspace
npm run build --workspace=apps/api

# Or navigate and build
cd apps/api && npm run build
```

### Listing Workspaces

```bash
# List all workspaces
npm workspaces list

# Output:
# apps/api
# packages/database
# packages/redis
```

### Adding New Workspace

```bash
# 1. Create directory
mkdir -p apps/new-app

# 2. Initialize package.json
cd apps/new-app
npm init -y

# 3. npm automatically recognizes it as workspace
cd ../..
npm install
```

---

## Best Practices

### 1. Naming Conventions

**Use scoped names for packages:**
```json
{
  "name": "@systemvibe/database"  // Good
}
```

**Avoid generic names:**
```json
{
  "name": "database"  // Bad - could conflict with npm registry
}
```

### 2. Version Management

**Keep versions in sync:**
```json
// packages/database/package.json
{
  "version": "0.1.0"
}

// apps/api/package.json
{
  "dependencies": {
    "@systemvibe/database": "^0.1.0"  // Matches package version
  }
}
```

### 3. Dependency Organization

**Put shared code in packages:**
- Database client → `packages/database`
- Redis utilities → `packages/redis`
- Shared types → `packages/shared`

**Put deployable code in apps:**
- API server → `apps/api`
- Worker → `apps/worker`
- Webhook handler → `apps/webhook`

### 4. Git Ignore

```gitignore
# Ignore node_modules (only at root)
node_modules/

# Ignore build outputs
dist/
build/
*.tsbuildinfo

# Ignore environment files
.env
.env.local
```

**Don't ignore workspace node_modules** - npm workspaces handles this automatically.

### 5. CI/CD

**Build all workspaces:**
```yaml
# .github/workflows/ci.yml
- name: Install dependencies
  run: npm install

- name: Build
  run: npm run build

- name: Test
  run: npm run test
```

---

## Troubleshooting

### Issue: Workspace not recognized

**Problem:**
```bash
npm workspaces list
# Doesn't show new workspace
```

**Solution:**
1. Check root `package.json` has correct workspace pattern
2. Ensure workspace has `package.json`
3. Run `npm install` to refresh

### Issue: Dependency not found

**Problem:**
```bash
Error: Cannot find module '@systemvibe/database'
```

**Solution:**
```bash
# Install the workspace dependency
npm install --workspace=apps/api @systemvibe/database

# Or install all dependencies
npm install
```

### Issue: Version conflicts

**Problem:**
```bash
npm ERR! peer dep missing: @nestjs/common@^10.0.0
```

**Solution:**
```bash
# Install missing peer dependency
npm install --workspace=apps/api @nestjs/common@^10.0.0
```

### Issue: Hoisting problems

**Problem:**
```bash
Error: Multiple versions of same package
```

**Solution:**
```bash
# Clean install
rm -rf node_modules
npm install
```

---

## SystemVibe Examples

### Example 1: Adding a New Dependency to API

```bash
# Traditional way (would be)
cd apps/api
npm install axios

# Monorepo way (from root)
npm install --workspace=apps/api axios
```

**Result:**
- `axios` added to `apps/api/package.json`
- `axios` installed in root `node_modules`
- Available to all workspaces

### Example 2: Using Shared Database Package

```typescript
// apps/api/src/some.service.ts
import { PrismaClient } from '@prisma/client';  // External
import getRedisClient from '@systemvibe/redis'; // Local workspace

const prisma = new PrismaClient();
const redis = getRedisClient();
```

**How it works:**
1. `@prisma/client` from npm registry
2. `@systemvibe/redis` symlinked to `packages/redis`
3. Both available via import

### Example 3: Building the Project

```bash
# Build everything
npm run build

# Output:
# @systemvibe/database@0.1.0 build
# > tsc
#
# @systemvibe/redis@0.1.0 build
# > tsc
#
# systemvibe-api@0.1.0 build
# > nest build
```

### Example 4: Running API in Development

```bash
# Option 1: From root with env vars
DATABASE_URL="postgresql://..." REDIS_URL="redis://..." npm run dev --workspace=apps/api

# Option 2: Navigate to workspace
cd apps/api
DATABASE_URL="postgresql://..." REDIS_URL="redis://..." npm run dev
```

### Example 5: Adding a New Shared Package

```bash
# 1. Create package
mkdir -p packages/logger
cd packages/logger
npm init -y

# 2. Edit package.json
{
  "name": "@systemvibe/logger",
  "version": "0.1.0",
  "main": "dist/index.js"
}

# 3. Create source
mkdir src
echo "export const log = (msg: string) => console.log(msg);" > src/index.ts

# 4. Add TypeScript config
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true
  }
}
EOF

# 5. Install dependencies
cd ../..
npm install --workspace=packages/logger -D typescript

# 6. Use in API
npm install --workspace=apps/api @systemvibe/logger
```

---

## Key Takeaways

### For Traditional Repo Developers:

1. **Multiple package.json files** - Each workspace has its own
2. **Dependencies are shared** - Common packages hoisted to root
3. **Local packages are linked** - No need to publish to npm
4. **Scripts can run across workspaces** - Use `--ws` flag
5. **Install from root** - Use `--workspace` flag for specific packages

### Benefits Over Traditional Approach:

✅ **Code Reuse** - Share code between apps easily
✅ **Consistent Dependencies** - Same versions across project
✅ **Atomic Commits** - Change multiple packages in one commit
✅ **Simplified CI/CD** - One pipeline for all packages
✅ **Type Safety** - Shared types across workspaces

### Trade-offs:

❌ **More Complex** - Harder to understand initially
❌ **Larger Repository** - More code in one place
❌ **Slower Git Operations** - More files to track
❌ **Build Time** - Building all packages takes longer

---

## Quick Reference

```bash
# Install all dependencies
npm install

# Install for specific workspace
npm install --workspace=<workspace> <package>

# Run script in specific workspace
npm run <script> --workspace=<workspace>

# Run script in all workspaces
npm run <script> --ws

# Build all workspaces
npm run build

# List workspaces
npm workspaces list

# Add new workspace
mkdir -p apps/new-app && cd apps/new-app && npm init -y
```

---

**You're now ready to work with monorepos! 🚀**

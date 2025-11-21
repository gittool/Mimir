# DevContainer Configuration Updates

**Date:** November 21, 2025  
**Status:** ✅ Complete

## Summary

Updated the VS Code devcontainer configuration to align with the current Docker Compose architecture and recent infrastructure changes.

## Issues Fixed

### 1. ❌ Non-existent startup script

**Problem:** `initializeCommand` referenced `./scripts/start.sh` which doesn't exist  
**Solution:** Removed `initializeCommand` - Docker Compose handles service startup automatically

### 2. ❌ Wrong service name

**Problem:** Referenced `mimir-server` service from production compose file  
**Solution:** Created new `mimir-dev` service in `docker-compose.extend.yml` specifically for development

### 3. ❌ User mismatch

**Problem:** Devcontainer Dockerfile created `developer` user, production uses `node`  
**Solution:** Updated to use `node` user (already exists in node:22-alpine base image)

### 4. ❌ Workspace folder mismatch

**Problem:** Used `/workspace` but production Dockerfile uses `/app`  
**Solution:** Changed `workspaceFolder` to `/app` to match production

### 5. ❌ Unnecessary features

**Problem:** Included node, git features when custom Dockerfile already has them  
**Solution:** Removed features section entirely

### 6. ❌ Outdated service references

**Problem:** Comments referenced "Ollama" instead of "llama-server"  
**Solution:** Updated all references to match current architecture

### 7. ⚠️ Architecture-specific compose files

**Problem:** Can't auto-detect architecture in static JSON  
**Solution:** Added clear instructions for manual selection (arm64/amd64/default)

## Files Modified

### Created

- `.devcontainer/docker-compose.extend.yml` - Development service definition
- `.devcontainer/CHANGES.md` - This document

### Updated

- `.devcontainer/devcontainer.json`

  - Changed service: `mimir-server` → `mimir-dev`
  - Added second compose file: `docker-compose.extend.yml`
  - Changed workspaceFolder: `/workspace` → `/app`
  - Removed `initializeCommand`
  - Removed `features` section
  - Removed duplicate `mounts` section
  - Updated port comments
  - Added architecture selection note

- `.devcontainer/Dockerfile`

  - Removed `developer` user creation (use existing `node` user)
  - Changed WORKDIR: `/workspace` → `/app`
  - Removed unnecessary packages (openjdk, eslint, prettier)
  - Simplified to essentials

- `.devcontainer/README.md`
  - Added architecture selection step
  - Updated service names
  - Clarified setup process
  - Updated "What's Included" section

## Architecture Selection

Users must manually select the appropriate docker-compose file in `devcontainer.json`:

```jsonc
// ARM64 (Apple Silicon, Linux ARM)
"dockerComposeFile": ["../docker-compose.arm64.yml", "docker-compose.extend.yml"],

// x64/AMD64 (Intel Mac, Linux x64) - DEFAULT
"dockerComposeFile": ["../docker-compose.yml", "docker-compose.extend.yml"],

// Windows/Linux with NVIDIA GPU
"dockerComposeFile": ["../docker-compose.amd64.yml", "docker-compose.extend.yml"],
```

## Services in Development Container

When running the devcontainer, these services start:

| Service        | Port(s)    | Description                        |
| -------------- | ---------- | ---------------------------------- |
| `neo4j`        | 7474, 7687 | Graph database                     |
| `copilot-api`  | 4141       | LLM API (OpenAI-compatible)        |
| `llama-server` | 11434→8080 | Embeddings (architecture-specific) |
| `mimir-dev`    | 9042, 5173 | Development container              |

## Development Workflow

```bash
# Inside devcontainer terminal

# Install dependencies (auto-runs on container creation)
npm install
cd frontend && npm install

# Backend development with hot reload
npm run dev

# Frontend development
cd frontend && npm run dev

# Start MCP server
npm run start:mcp

# Start HTTP server
npm run start:http

# Build everything
npm run build:all
```

## Testing the Configuration

1. Ensure you have Docker Desktop running
2. Open the project in VS Code
3. Edit `.devcontainer/devcontainer.json` line 4 for your architecture
4. Press F1 → "Dev Containers: Reopen in Container"
5. Wait ~3-5 minutes for first-time setup
6. Verify all services are running: `docker compose ps`
7. Access Neo4j Browser: http://localhost:7474
8. Test the devcontainer: `npm run dev`

## Known Limitations

1. **Manual architecture selection required** - Cannot auto-detect in JSON config
2. **No Docker-in-Docker** - Removed to reduce complexity; use host Docker or compose commands
3. **Base image vulnerability** - node:22-alpine has 1 high vulnerability (upstream issue)

## Next Steps

- [ ] Consider creating architecture-specific devcontainer.json files (e.g., `.devcontainer-arm64/`)
- [ ] Investigate automated architecture detection via pre-build script
- [ ] Document how to switch between production and development environments
- [ ] Add health checks for devcontainer service

## References

- Docker Compose: `docker-compose.yml`, `docker-compose.arm64.yml`, `docker-compose.amd64.yml`
- Startup script: `scripts/start.js` (Node.js, auto-detects architecture)
- Production Dockerfile: `Dockerfile` (multi-stage build)
- Dev Dockerfile: `.devcontainer/Dockerfile` (simple dev tools)

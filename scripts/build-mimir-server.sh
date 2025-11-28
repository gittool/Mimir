#!/bin/bash
# Build and push mimir-server Docker image
# Usage: ./scripts/build-mimir-server.sh [--push] [--no-cache] [--version X.Y.Z]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
PUSH=false
NO_CACHE=""
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "1.0.0")
IMAGE_NAME="timothyswt/mimir-server"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --push)
            PUSH=true
            shift
            ;;
        --no-cache)
            NO_CACHE="--no-cache"
            shift
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --push        Push image to Docker Hub after building"
            echo "  --no-cache    Build without Docker cache"
            echo "  --version X.Y.Z  Override version tag (default: from package.json)"
            echo "  --help        Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🚀 Building Mimir Server Docker Image${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "📦 Image: ${YELLOW}${IMAGE_NAME}${NC}"
echo -e "🏷️  Version: ${YELLOW}${VERSION}${NC}"
echo -e "🏷️  Tags: ${YELLOW}${VERSION}, latest${NC}"
echo ""

# Step 1: Build TypeScript and frontend
echo -e "${YELLOW}📝 Step 1: Building TypeScript and frontend...${NC}"
npm run build:all

# Step 2: Build Docker image
echo ""
echo -e "${YELLOW}🐳 Step 2: Building Docker image...${NC}"
docker build $NO_CACHE \
    -t "${IMAGE_NAME}:${VERSION}" \
    -t "${IMAGE_NAME}:latest" \
    .

echo ""
echo -e "${GREEN}✅ Build complete!${NC}"
echo -e "   ${IMAGE_NAME}:${VERSION}"
echo -e "   ${IMAGE_NAME}:latest"

# Step 3: Push if requested
if [ "$PUSH" = true ]; then
    echo ""
    echo -e "${YELLOW}📤 Step 3: Pushing to Docker Hub...${NC}"
    docker push "${IMAGE_NAME}:${VERSION}"
    docker push "${IMAGE_NAME}:latest"
    echo ""
    echo -e "${GREEN}✅ Push complete!${NC}"
    echo -e "   https://hub.docker.com/r/${IMAGE_NAME}/tags"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 Done!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"


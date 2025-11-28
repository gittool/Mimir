# NornicDB Native Embeddings Integration Plan (REVISED)

**Version:** 1.1.0  
**Date:** November 28, 2025  
**Status:** Draft Implementation Plan - **APPROVED**

---

## Executive Summary

Enable Mimir to leverage NornicDB's native embedding capabilities while maintaining 100% backwards compatibility with Neo4j deployments. When connected to NornicDB, Mimir will delegate embedding generation to the database while retaining only vision-language model calls for image descriptions. **VL providers are fully configurable and can reuse the default LLM provider.**

---

## 1. Database Provider Detection

### Detection Strategy

**Location:** `src/managers/GraphManager.ts` (or new `src/config/database-provider.ts`)

```typescript
enum DatabaseProvider {
  NEO4J = 'neo4j',
  NORNICDB = 'nornicdb'
}

class DatabaseProviderDetector {
  async detectProvider(uri: string): Promise<DatabaseProvider> {
    // Method 1: Check health endpoint for NornicDB signature
    const healthCheck = await fetch(`${httpUrl}/health`);
    const headers = healthCheck.headers.get('x-database-engine');
    if (headers?.includes('nornicdb')) return DatabaseProvider.NORNICDB;
    
    // Method 2: Query for NornicDB-specific procedures
    const result = await session.run('CALL dbms.procedures() YIELD name WHERE name STARTS WITH "nornicdb." RETURN count(name) as count');
    if (result.records[0].get('count') > 0) return DatabaseProvider.NORNICDB;
    
    // Default to Neo4j
    return DatabaseProvider.NEO4J;
  }
}
```

**Environment Variable Override:**
```bash
MIMIR_DATABASE_PROVIDER=nornicdb  # or 'neo4j' (default: auto-detect)
```

---

## 2. Vision Language Provider Configuration

### Flexible VL Provider Selection

**Key Requirement:** VL provider should be independently configurable and can reuse existing LLM provider infrastructure.

### Configuration Hierarchy (Priority Order)

```typescript
class VisionLanguageConfig {
  getVLProvider(): LLMConfig {
    // 1. Explicit VL-specific configuration (highest priority)
    if (process.env.MIMIR_EMBEDDINGS_VL_PROVIDER) {
      return {
        provider: process.env.MIMIR_EMBEDDINGS_VL_PROVIDER,
        apiUrl: process.env.MIMIR_EMBEDDINGS_VL_API,
        apiPath: process.env.MIMIR_EMBEDDINGS_VL_API_PATH,
        apiKey: process.env.MIMIR_EMBEDDINGS_VL_API_KEY,
        model: process.env.MIMIR_EMBEDDINGS_VL_MODEL,
        // ... other VL-specific settings
      };
    }
    
    // 2. Reuse default LLM provider (fallback)
    return {
      provider: process.env.MIMIR_DEFAULT_PROVIDER,
      apiUrl: process.env.MIMIR_LLM_API,
      apiPath: process.env.MIMIR_LLM_API_PATH,
      apiKey: process.env.MIMIR_LLM_API_KEY,
      model: process.env.MIMIR_DEFAULT_MODEL,  // Use default model for descriptions
    };
  }
}
```

### Example Configurations

**Example 1: Dedicated VL Model (Current Behavior)**
```bash
# Use dedicated Qwen2.5-VL server
MIMIR_EMBEDDINGS_VL_PROVIDER=llama.cpp
MIMIR_EMBEDDINGS_VL_API=http://llama-vl-server-2b:8080
MIMIR_EMBEDDINGS_VL_MODEL=qwen2.5-vl
```

**Example 2: Reuse Default LLM (GPT-4V)**
```bash
# No VL vars set - automatically uses default LLM
MIMIR_DEFAULT_PROVIDER=openai
MIMIR_LLM_API=https://api.openai.com
MIMIR_DEFAULT_MODEL=gpt-4-vision-preview  # VL-capable model
```

**Example 3: Reuse Copilot (Claude Sonnet 3.5 with Vision)**
```bash
# No VL vars set - uses Copilot API with vision models
MIMIR_DEFAULT_PROVIDER=copilot
MIMIR_LLM_API=http://copilot-api:4141
MIMIR_DEFAULT_MODEL=claude-3.5-sonnet  # Supports images
```

**Example 4: Mix and Match**
```bash
# Use Copilot for chat, local Qwen for image descriptions
MIMIR_DEFAULT_PROVIDER=copilot
MIMIR_LLM_API=http://copilot-api:4141
MIMIR_DEFAULT_MODEL=gpt-4.1

# Override VL specifically
MIMIR_EMBEDDINGS_VL_PROVIDER=llama.cpp
MIMIR_EMBEDDINGS_VL_API=http://llama-vl-server:8080
MIMIR_EMBEDDINGS_VL_MODEL=qwen2.5-vl
```

---

## 3. Embedding Strategy by Provider

### Architecture Changes

**Create:** `src/services/EmbeddingStrategyFactory.ts`

```typescript
interface EmbeddingStrategy {
  shouldGenerateEmbedding(contentType: string): boolean;
  generateEmbedding(content: string): Promise<number[] | null>;
  handleImageFile(imagePath: string): Promise<string>;  // Returns description
}

class NornicDBStrategy implements EmbeddingStrategy {
  constructor(
    private vlService: VisionLanguageService  // Reusable VL service
  ) {}
  
  shouldGenerateEmbedding(contentType: string): boolean {
    return false;  // NornicDB handles all embeddings internally
  }
  
  async generateEmbedding(content: string): Promise<null> {
    return null;  // No-op - database handles it
  }
  
  async handleImageFile(imagePath: string): Promise<string> {
    // Use configured VL provider (could be default LLM or dedicated VL)
    return await this.vlService.describeImage(imagePath);
  }
}

class Neo4jStrategy implements EmbeddingStrategy {
  constructor(
    private embeddingService: EmbeddingService,
    private vlService: VisionLanguageService
  ) {}
  
  shouldGenerateEmbedding(contentType: string): boolean {
    return this.config.MIMIR_EMBEDDINGS_ENABLED;  // Existing logic
  }
  
  async generateEmbedding(content: string): Promise<number[]> {
    // Existing Mimir embedding generation logic
    return await this.embeddingService.embed(content);
  }
  
  async handleImageFile(imagePath: string): Promise<string> {
    // Use same VL service (unified interface)
    const description = await this.vlService.describeImage(imagePath);
    // Also generate embedding for Neo4j
    const embedding = await this.generateEmbedding(description);
    // Store embedding separately
    return description;
  }
}
```

---

## 4. VisionLanguageService Refactor

### Unified VL Service Interface

**Location:** `src/services/VisionLanguageService.ts`

```typescript
interface VLProviderConfig {
  provider: string;
  apiUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  contextSize?: number;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

class VisionLanguageService {
  private config: VLProviderConfig;
  
  constructor() {
    // Load config with fallback to default LLM
    this.config = this.loadVLConfig();
  }
  
  private loadVLConfig(): VLProviderConfig {
    // Priority 1: Explicit VL configuration
    if (process.env.MIMIR_EMBEDDINGS_VL_PROVIDER) {
      return {
        provider: process.env.MIMIR_EMBEDDINGS_VL_PROVIDER,
        apiUrl: process.env.MIMIR_EMBEDDINGS_VL_API!,
        apiPath: process.env.MIMIR_EMBEDDINGS_VL_API_PATH || '/v1/chat/completions',
        apiKey: process.env.MIMIR_EMBEDDINGS_VL_API_KEY || 'dummy-key',
        model: process.env.MIMIR_EMBEDDINGS_VL_MODEL!,
        contextSize: parseInt(process.env.MIMIR_EMBEDDINGS_VL_CONTEXT_SIZE || '131072'),
        maxTokens: parseInt(process.env.MIMIR_EMBEDDINGS_VL_MAX_TOKENS || '2048'),
        temperature: parseFloat(process.env.MIMIR_EMBEDDINGS_VL_TEMPERATURE || '0.7'),
        timeout: parseInt(process.env.MIMIR_EMBEDDINGS_VL_TIMEOUT || '180000'),
      };
    }
    
    // Priority 2: Reuse default LLM provider
    return {
      provider: process.env.MIMIR_DEFAULT_PROVIDER || 'copilot',
      apiUrl: process.env.MIMIR_LLM_API!,
      apiPath: process.env.MIMIR_LLM_API_PATH || '/v1/chat/completions',
      apiKey: process.env.MIMIR_LLM_API_KEY || 'dummy-key',
      model: process.env.MIMIR_DEFAULT_MODEL || 'gpt-4.1',
      maxTokens: 2048,
      temperature: 0.7,
      timeout: 180000,
    };
  }
  
  async describeImage(imagePath: string): Promise<string> {
    // Universal OpenAI-compatible image description
    const imageData = await this.loadImageAsBase64(imagePath);
    
    const response = await fetch(`${this.config.apiUrl}${this.config.apiPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Describe this image in detail. Focus on key visual elements, composition, style, and any text or notable features.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageData}`
                }
              }
            ]
          }
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    });
    
    const result = await response.json();
    return result.choices[0].message.content;
  }
  
  private async loadImageAsBase64(imagePath: string): Promise<string> {
    // Reuse existing image loading logic
    const buffer = await fs.readFile(imagePath);
    return buffer.toString('base64');
  }
}
```

---

## 5. File Changes Required

### Core Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `src/managers/GraphManager.ts` | **MODIFY** | Add provider detection, inject strategy |
| `src/services/EmbeddingService.ts` | **MODIFY** | Wrap with strategy pattern |
| `src/services/VisionLanguageService.ts` | **REFACTOR** | Unified VL provider with fallback to default LLM |
| `src/indexing/FileIndexer.ts` | **MODIFY** | Use strategy for file indexing |
| `src/indexing/DocumentParser.ts` | **MODIFY** | Conditionally generate embeddings |
| `src/api/nodes-api.ts` | **MODIFY** | Don't accept embeddings when NornicDB |
| `src/config/database-provider.ts` | **NEW** | Provider detection utility |
| `src/config/vl-provider.ts` | **NEW** | VL provider config with LLM fallback |
| `src/services/EmbeddingStrategyFactory.ts` | **NEW** | Strategy factory |

---

## 6. Implementation Phases

### Phase 1: Detection & Configuration (2-4 hours)
- ✅ Implement database provider detection
- ✅ Add `MIMIR_DATABASE_PROVIDER` env var
- ✅ Create provider detection utility with health check + Cypher probe
- ✅ Implement VL provider config with LLM fallback
- ✅ Add logging for detected provider and VL config

### Phase 2: VL Service Refactor (3-4 hours)
- ✅ Extract VL config loading logic
- ✅ Implement fallback to default LLM provider
- ✅ Test VL service with multiple provider types
- ✅ Ensure OpenAI-compatible API format for all providers

### Phase 3: Strategy Pattern (4-6 hours)
- ✅ Create `EmbeddingStrategy` interface
- ✅ Implement `NornicDBStrategy` (no-op embeddings, VL only)
- ✅ Implement `Neo4jStrategy` (existing logic + VL)
- ✅ Create factory to select strategy based on provider
- ✅ Inject both strategy and VL service into `GraphManager`

### Phase 4: Integration (6-8 hours)
- ✅ Update `FileIndexer` to use strategy
- ✅ Update `DocumentParser` to conditionally embed
- ✅ Update node creation APIs to reject embeddings for NornicDB
- ✅ Update MCP tools to use strategy
- ✅ Ensure VL service is reusable across both strategies

### Phase 5: Testing & Validation (4-6 hours)
- ✅ Test with Neo4j + dedicated VL model
- ✅ Test with NornicDB + dedicated VL model
- ✅ Test with NornicDB + default LLM (GPT-4V)
- ✅ Test with NornicDB + Copilot (Claude Sonnet)
- ✅ Test provider auto-detection
- ✅ Integration tests for all configurations

---

## 7. Configuration Changes

### New Environment Variables

```bash
# Database Provider (auto-detect by default)
MIMIR_DATABASE_PROVIDER=auto  # Options: auto, neo4j, nornicdb

# NornicDB-specific settings (optional overrides)
MIMIR_NORNICDB_SKIP_EMBEDDINGS=true  # Default: true (use native)
MIMIR_NORNICDB_VL_ONLY=true          # Default: true (only VL calls)
```

### VL Provider Configuration (Priority Order)

**Option 1: Dedicated VL Provider (Explicit)**
```bash
# Highest priority - explicit VL configuration
MIMIR_EMBEDDINGS_VL_PROVIDER=llama.cpp
MIMIR_EMBEDDINGS_VL_API=http://llama-vl-server-2b:8080
MIMIR_EMBEDDINGS_VL_API_PATH=/v1/chat/completions
MIMIR_EMBEDDINGS_VL_API_KEY=dummy-key
MIMIR_EMBEDDINGS_VL_MODEL=qwen2.5-vl
MIMIR_EMBEDDINGS_VL_CONTEXT_SIZE=131072
MIMIR_EMBEDDINGS_VL_MAX_TOKENS=2048
MIMIR_EMBEDDINGS_VL_TEMPERATURE=0.7
MIMIR_EMBEDDINGS_VL_TIMEOUT=180000
```

**Option 2: Reuse Default LLM (Automatic Fallback)**
```bash
# When no VL vars are set, automatically use default LLM
MIMIR_DEFAULT_PROVIDER=copilot  # or 'openai', 'anthropic', etc.
MIMIR_LLM_API=http://copilot-api:4141
MIMIR_LLM_API_PATH=/v1/chat/completions
MIMIR_LLM_API_KEY=dummy-key
MIMIR_DEFAULT_MODEL=gpt-4.1  # Must support vision API

# No VL vars needed - will automatically use above config
```

**Option 3: Mix and Match**
```bash
# Use different providers for chat vs image descriptions
MIMIR_DEFAULT_PROVIDER=copilot
MIMIR_LLM_API=http://copilot-api:4141
MIMIR_DEFAULT_MODEL=gpt-4.1

# Override for image descriptions only
MIMIR_EMBEDDINGS_VL_PROVIDER=llama.cpp
MIMIR_EMBEDDINGS_VL_API=http://llama-vl-server:8080
MIMIR_EMBEDDINGS_VL_MODEL=qwen2.5-vl
```

### Existing Variables (No Breaking Changes)
- All `MIMIR_EMBEDDINGS_*` variables still respected for Neo4j
- All existing `MIMIR_EMBEDDINGS_VL_*` variables still work
- New fallback behavior only when VL vars are not set
- No breaking changes to existing deployments

---

## 8. Backwards Compatibility Checklist

### Neo4j Mode (Existing Behavior)
- ✅ Embeddings generated by Mimir for text content
- ✅ Embeddings generated for image descriptions
- ✅ All existing env vars respected (`MIMIR_EMBEDDINGS_*`)
- ✅ VL provider can be dedicated or reuse default LLM
- ✅ File indexing with embeddings works as before
- ✅ Vector search uses Mimir-generated embeddings
- ✅ No breaking changes to MCP tools
- ✅ No breaking changes to REST APIs

### NornicDB Mode (New Behavior)
- ✅ No embedding generation by Mimir (delegated)
- ✅ VL provider can be dedicated or reuse default LLM
- ✅ VL model called for image descriptions (same interface)
- ✅ Text descriptions stored in properties
- ✅ NornicDB generates embeddings internally via async queue
- ✅ Vector search uses NornicDB-generated embeddings
- ✅ Same MCP tool interface (transparent to users)
- ✅ Zero config needed if default LLM supports vision

---

## 9. Key Design Decisions

### Decision 1: Strategy Pattern Over Conditionals
**Rationale:** Clean separation of concerns, testable, extensible for future providers

### Decision 2: Auto-Detection with Override
**Rationale:** Zero-config for most users, manual override for edge cases

### Decision 3: VL Service Reusability
**Rationale:** 
- Single VL service used by both strategies
- Fallback to default LLM eliminates need for dedicated VL server
- OpenAI-compatible API makes all providers interchangeable
- Users can choose cost/performance tradeoffs easily

### Decision 4: Configuration Hierarchy
**Rationale:**
- Explicit VL config takes precedence (power users)
- Automatic LLM fallback for simplicity (most users)
- Mix-and-match for optimization scenarios
- Zero breaking changes to existing setups

### Decision 5: No API Changes
**Rationale:** MCP tools and REST APIs remain unchanged - provider selection is internal

---

## 10. Code Reusability Matrix

| Component | Neo4j Strategy | NornicDB Strategy | Reusability |
|-----------|----------------|-------------------|-------------|
| **VL Service** | ✅ Uses | ✅ Uses | 100% shared |
| **VL Config Loading** | ✅ Uses | ✅ Uses | 100% shared |
| **Image Base64 Encoding** | ✅ Uses | ✅ Uses | 100% shared |
| **OpenAI API Client** | ✅ Uses | ✅ Uses | 100% shared |
| **Embedding Service** | ✅ Uses | ❌ Skips | Strategy-specific |
| **Embedding Config** | ✅ Uses | ❌ Ignored | Strategy-specific |

**Reuse Score: 80%** - VL logic fully shared, only embedding generation differs

---

## 11. Testing Strategy

### Unit Tests
- Provider detection (mock health endpoints)
- Strategy selection (factory tests)
- VL config loading (with/without explicit config)
- VL service (multiple provider types)
- Neo4j strategy (existing behavior)
- NornicDB strategy (no-op embeddings)

### Integration Tests
- **Neo4j + Mimir embeddings + dedicated VL** (existing)
- **Neo4j + Mimir embeddings + default LLM VL** (new)
- **NornicDB + native embeddings + dedicated VL** (new)
- **NornicDB + native embeddings + default LLM VL** (new)
- **NornicDB + native embeddings + Copilot VL** (new)
- **Image indexing** (all configurations)
- **Vector search** (both providers)
- **Provider auto-detection** (both databases)

### Manual Testing Checklist
- [ ] Deploy with Neo4j + Qwen VL, verify Mimir embeddings
- [ ] Deploy with Neo4j + GPT-4V (default LLM), verify embeddings
- [ ] Deploy with NornicDB + Qwen VL, verify no Mimir embeddings
- [ ] Deploy with NornicDB + GPT-4V (default LLM), verify descriptions
- [ ] Deploy with NornicDB + Claude Sonnet (Copilot), verify descriptions
- [ ] Index images with all configurations
- [ ] Query vector search with both providers
- [ ] Switch providers without config changes (auto-detect)

---

## 12. Example Deployment Configurations

### Minimal Setup (NornicDB + Copilot)
```bash
# Only 3 variables needed!
NEO4J_URI=bolt://nornicdb:7687
MIMIR_DEFAULT_PROVIDER=copilot
MIMIR_LLM_API=http://copilot-api:4141

# Auto-detects NornicDB
# Uses Copilot for both chat AND image descriptions
# No dedicated VL server needed
```

### High Performance (NornicDB + Dedicated VL)
```bash
NEO4J_URI=bolt://nornicdb:7687
MIMIR_DEFAULT_PROVIDER=copilot
MIMIR_LLM_API=http://copilot-api:4141

# Dedicated local VL model for fast image processing
MIMIR_EMBEDDINGS_VL_PROVIDER=llama.cpp
MIMIR_EMBEDDINGS_VL_API=http://llama-vl-server:8080
MIMIR_EMBEDDINGS_VL_MODEL=qwen2.5-vl
```

### Cost Optimized (NornicDB + GPT-4V)
```bash
NEO4J_URI=bolt://nornicdb:7687
MIMIR_DEFAULT_PROVIDER=openai
MIMIR_LLM_API=https://api.openai.com
MIMIR_DEFAULT_MODEL=gpt-4-vision-preview

# Uses GPT-4V for both chat and images
# No local models needed
# Pay per use
```

### Backwards Compatible (Neo4j + Everything)
```bash
NEO4J_URI=bolt://neo4j:7687
MIMIR_EMBEDDINGS_ENABLED=true
MIMIR_EMBEDDINGS_API=http://llama-server:8080
MIMIR_EMBEDDINGS_MODEL=mxbai-embed-large

# Dedicated VL as before
MIMIR_EMBEDDINGS_VL_PROVIDER=llama.cpp
MIMIR_EMBEDDINGS_VL_API=http://llama-vl-server:8080
MIMIR_EMBEDDINGS_VL_MODEL=qwen2.5-vl

# Everything works exactly as before
```

---

## 13. Success Metrics

- ✅ **Zero breaking changes** for Neo4j users
- ✅ **Zero embedding calls** when using NornicDB (except VL)
- ✅ **VL provider reusability** - can use default LLM
- ✅ **Configuration simplicity** - 80% of users need no VL vars
- ✅ **Auto-detection accuracy** >99%
- ✅ **Performance improvement** with NornicDB (no embedding overhead)
- ✅ **Same MCP tool API** for both providers
- ✅ **All existing tests pass** with Neo4j
- ✅ **New tests pass** with NornicDB

---

## 14. Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Auto-detection fails | High | Manual override via env var |
| Breaking Neo4j users | Critical | Comprehensive test suite + canary deployment |
| VL service coupling | Medium | Separate service interface |
| Performance regression | Medium | Benchmark both providers |
| Config complexity | Medium | Clear fallback hierarchy + docs |

---

**Estimated Total Effort:** 19-28 hours (added 3-4 hours for VL refactor)  
**Priority:** High (enables NornicDB native features + simplifies configuration)  
**Dependencies:** None (self-contained changes)  

**Next Steps:** 
1. ✅ Review revised plan
2. ✅ Approve plan
3. ⏳ Begin Phase 1 implementation
4. ⏳ Create feature branch `feature/nornicdb-native-embeddings`
5. ⏳ Implement provider detection
6. ⏳ Implement VL service refactor
7. ⏳ Implement strategy pattern
8. ⏳ Integration and testing
9. ⏳ Documentation updates
10. ⏳ Merge and release

---

**Document Status:** ✅ Saved to repository  
**Location:** `docs/architecture/NORNICDB_NATIVE_EMBEDDINGS_PLAN.md`  
**Last Updated:** November 28, 2025

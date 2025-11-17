# Conversation Persistence with Embeddings + Retrieval

## Overview

**Option 4 Implementation** - The most advanced approach for conversation persistence in LangGraph agents.

This system provides:
- **Vector-based semantic retrieval** of relevant past messages
- **Automatic embedding generation** for all conversations
- **Session-based storage** in Neo4j graph database
- **Smart context assembly** combining recent + semantically relevant messages

## Architecture

### How It Works

```
User Query → Embed Query → Search Past Messages (by similarity) → Retrieve Top K
              ↓
         Recent N Messages (always included)
              ↓
    [System Prompt] + [Retrieved Context] + [Recent Messages] + [New Query]
              ↓
         Agent Execution
              ↓
         Store Response with Embedding
```

### Key Components

1. **ConversationHistoryManager** (`src/orchestrator/ConversationHistoryManager.ts`)
   - Stores messages with embeddings in Neo4j
   - Retrieves semantically relevant past messages
   - Builds complete conversation context

2. **Integration with CopilotAgentClient** (`src/orchestrator/llm-client.ts`)
   - Optional `sessionId` parameter enables persistence
   - Automatic context retrieval before execution
   - Automatic storage after successful completion

3. **Vector Infrastructure** (existing)
   - `EmbeddingsService` - Ollama/OpenAI embedding generation
   - `UnifiedSearchService` - Semantic search
   - Neo4j vector indexes

## Configuration

### Environment Variables

```bash
# Neo4j Connection (required)
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=yourpassword

# Embeddings Configuration (from llmconfig.json)
# See docs/guides/VECTOR_EMBEDDINGS_GUIDE.md for details
```

### Tunable Parameters

In `ConversationHistoryManager`:

```typescript
private readonly RECENT_MESSAGE_COUNT = 5;      // Always include last N messages
private readonly RETRIEVED_MESSAGE_COUNT = 10;  // Retrieve top K relevant messages
private readonly MIN_SIMILARITY = 0.70;         // Minimum similarity threshold (0-1)
```

**Tuning Guidelines:**
- **RECENT_MESSAGE_COUNT**: 3-10 messages (higher = better continuity, more tokens)
- **RETRIEVED_MESSAGE_COUNT**: 5-20 messages (higher = more context, more tokens)
- **MIN_SIMILARITY**: 0.65-0.85 (lower = more results, less relevant; higher = fewer, more relevant)

## Usage

### 1. Initialize Conversation History

```typescript
import { CopilotAgentClient } from './orchestrator/llm-client.js';

const agent = new CopilotAgentClient({
  preamblePath: 'docs/agents/claudette-mimir-v2.md',
  model: 'gpt-4',
  temperature: 0.0
});

await agent.loadPreamble('docs/agents/claudette-mimir-v2.md');

// Enable conversation persistence
await agent.initializeConversationHistory();
```

### 2. Execute with Session ID

```typescript
const sessionId = 'user-123-chat-session';

// First message in conversation
const result1 = await agent.execute(
  'Research vector databases and store findings',
  0, // retryCount
  undefined, // circuitBreakerLimit
  sessionId // Enable persistence
);

// Second message - will retrieve relevant context from first message
const result2 = await agent.execute(
  'Which vector database did we decide was best for our use case?',
  0,
  undefined,
  sessionId // Same session - retrieves context
);
```

### 3. Session Management

```typescript
// Get session statistics
const stats = await agent.conversationHistory.getSessionStats(sessionId);
console.log(`Total messages: ${stats.totalMessages}`);
console.log(`User messages: ${stats.userMessages}`);
console.log(`Assistant messages: ${stats.assistantMessages}`);
console.log(`Embedded messages: ${stats.embeddedMessages}`);

// Clear session history
await agent.conversationHistory.clearSession(sessionId);
```

## How Context is Built

### Example Scenario

**Session History:**
- Message 1 (1 hour ago): "I'm building a React app with TypeScript"
- Message 2 (50 min ago): "I want to use PostgreSQL for the database"
- Message 3 (40 min ago): "Add Redis for caching"
- Message 4 (30 min ago): "Implement authentication with JWT"
- Message 5 (20 min ago): "Add email verification"
- Message 6 (10 min ago): "Create user profile page"
- Message 7 (5 min ago): "Add profile picture upload"

**New Query:** "What database are we using and what's the schema for users?"

**Context Assembly:**

1. **Recent Messages** (last 5):
   - Message 3: Redis caching
   - Message 4: JWT auth
   - Message 5: Email verification
   - Message 6: User profile
   - Message 7: Profile pictures

2. **Retrieved by Similarity** (semantic search):
   - Message 2: PostgreSQL database ← High similarity to "database"
   - Message 1: React + TypeScript ← Moderate similarity to "users"

3. **Final Context Sent to Agent:**
   ```
   [System Prompt]
   [RELEVANT PAST CONTEXT - 2 messages retrieved]
   - "I want to use PostgreSQL for the database"
   - "I'm building a React app with TypeScript"
   [END PAST CONTEXT]
   - "Add Redis for caching"
   - "Implement authentication with JWT"
   - "Add email verification"
   - "Create user profile page"
   - "Add profile picture upload"
   [New Query] "What database are we using and what's the schema for users?"
   ```

## Benefits Over Other Options

### vs Option 1 (Trim-Only)
- ✅ Preserves factual details from early conversation
- ✅ Can reference decisions made hours ago
- ❌ Higher complexity, requires vector store

### vs Option 2 (Trim + Summarization)
- ✅ No summarization errors/hallucinations
- ✅ Preserves exact wording of important decisions
- ✅ Retrieves only relevant context (not all history)
- ❌ Embedding cost for each message

### vs Option 3 (Checkpointer)
- ✅ Truly stateless agent (fresh agent per request)
- ✅ Selective context retrieval (not all history)
- ✅ Scales to very long conversations
- ❌ More complex setup

## Performance Characteristics

### Token Usage

**Without Conversation History:**
- System prompt: ~1000 tokens
- User query: ~50 tokens
- **Total input: ~1050 tokens**

**With Conversation History (typical):**
- System prompt: ~1000 tokens
- Retrieved context (10 messages × 100 tokens): ~1000 tokens
- Recent messages (5 messages × 100 tokens): ~500 tokens
- User query: ~50 tokens
- **Total input: ~2550 tokens**

**Trade-off:** ~2.4x more input tokens for full conversation context

### Latency

| Operation | Time | Notes |
|-----------|------|-------|
| Embed query | ~50-200ms | Depends on provider |
| Vector search | ~10-50ms | Neo4j index lookup |
| Build context | ~100-300ms | **Total overhead** |

### Cost Estimate (per message)

**Ollama (local):**
- Embedding generation: Free
- Vector storage: Free (Neo4j local)
- **Total: $0**

**OpenAI:**
- Embedding (text-embedding-3-small): $0.00002 per message
- Additional input tokens: ~$0.0015 per request (1500 tokens @ $0.001/1K)
- **Total: ~$0.002 per message**

## Troubleshooting

### Embeddings Not Working

```typescript
// Check if embeddings are enabled
const embeddingsEnabled = agent.conversationHistory.embeddingsService.isEnabled();
console.log(`Embeddings enabled: ${embeddingsEnabled}`);

// If false, check llmconfig.json:
{
  "embeddings": {
    "enabled": true,
    "provider": "ollama",
    "model": "nomic-embed-text"
  }
}
```

### No Context Retrieved

**Possible causes:**
1. **Similarity too low** - Lower `MIN_SIMILARITY` threshold
2. **Recent messages overlap** - Query context is all in recent N messages
3. **New session** - No history exists yet

### Vector Index Missing

```cypher
// Check if conversation index exists
SHOW INDEXES
YIELD name, type
WHERE name = 'conversation_message_embedding_index'
RETURN name, type;

// Create manually if needed
CREATE VECTOR INDEX conversation_message_embedding_index IF NOT EXISTS
FOR (m:ConversationMessage)
ON m.embedding
OPTIONS {indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}};
```

## Best Practices

### 1. Session ID Strategy

**Good:**
```typescript
// User-specific sessions
const sessionId = `user-${userId}-chat`;

// Task-specific sessions
const sessionId = `task-${taskId}`;

// Time-bound sessions
const sessionId = `${userId}-${date}`;
```

**Avoid:**
```typescript
// Global session (context pollution)
const sessionId = 'global';

// Random session (no continuity)
const sessionId = Math.random().toString();
```

### 2. When to Use

**Ideal for:**
- Long conversations (>10 exchanges)
- Technical discussions with many details
- Multi-step problem solving
- Reference to past decisions

**Not needed for:**
- Single-shot queries
- Stateless API calls
- One-off tasks

### 3. Session Cleanup

```typescript
// Clean up old sessions periodically
async function cleanupOldSessions(daysOld: number = 7) {
  const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
  
  await neo4jSession.run(`
    MATCH (m:ConversationMessage)
    WHERE m.timestamp < $cutoff
    DELETE m
  `, { cutoff: cutoffTime });
}
```

## Advanced Usage

### Custom Retrieval Parameters

```typescript
// Build context with custom parameters
const messages = await agent.conversationHistory.buildConversationContext(
  sessionId,
  systemPrompt,
  newQuery,
  {
    recentCount: 3,        // Only last 3 messages
    retrievedCount: 20,    // Retrieve top 20 similar messages
    minSimilarity: 0.75    // Higher threshold
  }
);
```

### Manual Message Storage

```typescript
// Store individual messages
const messageId = await agent.conversationHistory.storeMessage(
  sessionId,
  'user',
  'What database should we use?',
  { source: 'slack', channel: '#engineering' }
);

// Store complete turns
await agent.conversationHistory.storeConversationTurn(
  sessionId,
  'User message here',
  'Assistant response here',
  { metadata: 'optional' }
);
```

### Retrieve Without Building Full Context

```typescript
// Get recent messages only
const recent = await agent.conversationHistory.getRecentMessages(sessionId, 10);

// Get semantically similar messages
const relevant = await agent.conversationHistory.retrieveRelevantMessages(
  sessionId,
  'search query',
  10,      // count
  0.70,    // minSimilarity
  5        // excludeRecentCount
);
```

## See Also

- [Vector Embeddings Guide](./VECTOR_EMBEDDINGS_GUIDE.md)
- [Ollama Embeddings Quickstart](./OLLAMA_EMBEDDINGS_QUICKSTART.md)
- [Knowledge Graph Guide](./KNOWLEDGE_GRAPH.md)

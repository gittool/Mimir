/**
 * ConversationHistoryManager - Embeddings + Retrieval for Conversation Persistence
 * 
 * Implements Option 4 (Most Advanced):
 * - Embeds older messages as vectors
 * - Retrieves most relevant K messages per request
 * - Combines: system + retrieved context + recent + new
 * 
 * Features:
 * - Semantic similarity search for context retrieval
 * - Session-based message storage
 * - Automatic embedding generation
 * - Relevance-based context assembly
 */

import { Driver, Session } from 'neo4j-driver';
import neo4j from 'neo4j-driver';
import { BaseMessage, SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { EmbeddingsService } from '../indexing/EmbeddingsService.js';
import { UnifiedSearchService } from '../managers/UnifiedSearchService.js';

export interface ConversationMessage {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  embedding?: number[];
  metadata?: Record<string, any>;
}

export interface RetrievedMessage extends ConversationMessage {
  similarity: number;
  isRecent: boolean; // True if from recent N messages
}

export interface ConversationContext {
  systemMessage: BaseMessage;
  retrievedMessages: BaseMessage[]; // Semantically relevant past messages
  recentMessages: BaseMessage[]; // Most recent N messages
  newMessage: BaseMessage;
}

export class ConversationHistoryManager {
  private driver: Driver;
  private embeddingsService: EmbeddingsService;
  private initialized: boolean = false;

  // Configuration
  private readonly RECENT_MESSAGE_COUNT = 5; // Keep last 5 messages always
  private readonly RETRIEVED_MESSAGE_COUNT = 10; // Retrieve 10 relevant past messages
  private readonly MIN_SIMILARITY = 0.70; // Minimum similarity score for retrieval

  constructor(driver: Driver) {
    this.driver = driver;
    this.embeddingsService = new EmbeddingsService();
  }

  /**
   * Initialize the conversation history system
   * 
   * Sets up vector embeddings service and creates necessary Neo4j indexes
   * for conversation message storage and retrieval.
   * 
   * Must be called before using any other methods. Safe to call multiple times
   * (subsequent calls are no-ops).
   * 
   * @returns Promise that resolves when initialization is complete
   * 
   * @example
   * ```ts
   * const driver = neo4j.driver('bolt://localhost:7687');
   * const manager = new ConversationHistoryManager(driver);
   * 
   * await manager.initialize();
   * // Output: ✅ ConversationHistoryManager: Vector-based retrieval enabled
   * 
   * // Now ready to store and retrieve messages
   * await manager.addMessage('session-1', 'user', 'How do I use Docker?');
   * ```
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.embeddingsService.initialize();
      
      // Create conversation message index if it doesn't exist
      await this.createIndexes();
      
      this.initialized = true;
      
      if (this.embeddingsService.isEnabled()) {
        console.log('✅ ConversationHistoryManager: Vector-based retrieval enabled');
      } else {
        console.log('ℹ️  ConversationHistoryManager: Vector embeddings disabled, using recent messages only');
      }
    } catch (error: any) {
      console.warn('⚠️  Failed to initialize ConversationHistoryManager:', error.message);
      this.initialized = true; // Mark as initialized anyway
    }
  }

  /**
   * Create Neo4j indexes for conversation messages
   */
  private async createIndexes(): Promise<void> {
    const session = this.driver.session();
    
    try {
      // Create vector index for conversation embeddings if embeddings are enabled
      if (this.embeddingsService.isEnabled()) {
        try {
          // Check if index exists
          const indexCheck = await session.run(`
            SHOW INDEXES YIELD name
            WHERE name = 'conversation_message_embedding_index'
            RETURN count(*) as count
          `);
          
          const indexExists = indexCheck.records[0]?.get('count')?.toNumber() > 0;
          
          if (!indexExists) {
            console.log('Creating conversation message vector index...');
            await session.run(`
              CREATE VECTOR INDEX conversation_message_embedding_index IF NOT EXISTS
              FOR (m:ConversationMessage)
              ON m.embedding
              OPTIONS {indexConfig: {
                \`vector.dimensions\`: 768,
                \`vector.similarity_function\`: 'cosine'
              }}
            `);
            console.log('✅ Created conversation message vector index');
          }
        } catch (error: any) {
          console.warn('⚠️  Vector index creation failed:', error.message);
        }
      }

      // Create indexes for faster lookups
      await session.run(`
        CREATE INDEX conversation_session_idx IF NOT EXISTS
        FOR (m:ConversationMessage)
        ON (m.sessionId, m.timestamp)
      `);
      
      await session.run(`
        CREATE INDEX conversation_timestamp_idx IF NOT EXISTS
        FOR (m:ConversationMessage)
        ON m.timestamp
      `);
    } finally {
      await session.close();
    }
  }

  /**
   * Store a message in the conversation history
   */
  async storeMessage(
    sessionId: string,
    role: 'system' | 'user' | 'assistant' | 'tool',
    content: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    await this.initialize();

    const session = this.driver.session();
    const messageId = `msg_${sessionId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    try {
      // Generate embedding if enabled and content is substantial
      let embedding: number[] | null = null;
      if (this.embeddingsService.isEnabled() && content.trim().length > 10) {
        try {
          const embeddingResult = await this.embeddingsService.generateEmbedding(content);
          embedding = embeddingResult.embedding;
        } catch (error: any) {
          console.warn(`⚠️  Failed to generate embedding for message: ${error.message}`);
        }
      }

      // Store message in Neo4j
      await session.run(`
        CREATE (m:ConversationMessage:Node {
          id: $id,
          type: 'conversation_message',
          sessionId: $sessionId,
          role: $role,
          content: $content,
          timestamp: $timestamp,
          embedding: $embedding,
          metadata: $metadata
        })
      `, {
        id: messageId,
        sessionId,
        role,
        content,
        timestamp: neo4j.int(Date.now()),
        embedding: embedding,
        metadata: metadata || {}
      });

      return messageId;
    } finally {
      await session.close();
    }
  }

  /**
   * Get recent N messages from a session
   */
  async getRecentMessages(sessionId: string, count: number = 10): Promise<ConversationMessage[]> {
    await this.initialize();

    const session = this.driver.session();
    
    try {
      const result = await session.run(`
        MATCH (m:ConversationMessage)
        WHERE m.sessionId = $sessionId
        RETURN m
        ORDER BY m.timestamp DESC
        LIMIT $count
      `, {
        sessionId,
        count: neo4j.int(count)
      });

      return result.records
        .map(record => this.recordToMessage(record.get('m')))
        .reverse(); // Return in chronological order
    } finally {
      await session.close();
    }
  }

  /**
   * Retrieve semantically relevant messages for a new query
   */
  async retrieveRelevantMessages(
    sessionId: string,
    query: string,
    count: number = 10,
    minSimilarity: number = 0.70,
    excludeRecentCount: number = 5 // Don't retrieve messages that will be in recent set
  ): Promise<RetrievedMessage[]> {
    await this.initialize();

    // If embeddings disabled, return empty array (will rely on recent messages only)
    if (!this.embeddingsService.isEnabled()) {
      return [];
    }

    const session = this.driver.session();
    
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.embeddingsService.generateEmbedding(query);

      // Get timestamp of the Nth recent message to exclude from retrieval
      const recentThresholdResult = await session.run(`
        MATCH (m:ConversationMessage)
        WHERE m.sessionId = $sessionId
        RETURN m.timestamp as threshold
        ORDER BY m.timestamp DESC
        SKIP $excludeCount
        LIMIT 1
      `, {
        sessionId,
        excludeCount: neo4j.int(excludeRecentCount)
      });

      const recentThreshold = recentThresholdResult.records.length > 0
        ? recentThresholdResult.records[0].get('threshold').toNumber()
        : Date.now();

      // Perform vector similarity search
      const result = await session.run(`
        CALL db.index.vector.queryNodes('conversation_message_embedding_index', $limit, $queryVector)
        YIELD node, score
        WHERE node.sessionId = $sessionId
          AND score >= $minSimilarity
          AND node.timestamp < $recentThreshold
          AND node.role IN ['user', 'assistant']
        RETURN node, score
        ORDER BY score DESC
        LIMIT $count
      `, {
        queryVector: queryEmbedding.embedding,
        sessionId,
        minSimilarity,
        recentThreshold: neo4j.int(recentThreshold),
        limit: neo4j.int(count * 2), // Get more candidates
        count: neo4j.int(count)
      });

      return result.records.map(record => ({
        ...this.recordToMessage(record.get('node')),
        similarity: record.get('score'),
        isRecent: false
      }));
    } catch (error: any) {
      console.warn(`⚠️  Failed to retrieve relevant messages: ${error.message}`);
      return [];
    } finally {
      await session.close();
    }
  }

  /**
   * Build complete conversation context for agent execution
   * Combines: system message + retrieved relevant context + recent messages + new query
   */
  async buildConversationContext(
    sessionId: string,
    systemPrompt: string,
    newQuery: string,
    options?: {
      recentCount?: number;
      retrievedCount?: number;
      minSimilarity?: number;
    }
  ): Promise<BaseMessage[]> {
    await this.initialize();

    const recentCount = options?.recentCount ?? this.RECENT_MESSAGE_COUNT;
    const retrievedCount = options?.retrievedCount ?? this.RETRIEVED_MESSAGE_COUNT;
    const minSimilarity = options?.minSimilarity ?? this.MIN_SIMILARITY;

    // Get recent messages
    const recentMessages = await this.getRecentMessages(sessionId, recentCount);

    // Get semantically relevant messages (excluding recent ones)
    const retrievedMessages = await this.retrieveRelevantMessages(
      sessionId,
      newQuery,
      retrievedCount,
      minSimilarity,
      recentCount
    );

    // Build message array
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt)
    ];

    // Add retrieved context if we have any
    if (retrievedMessages.length > 0) {
      // Add a summary message to explain the retrieved context
      const contextSummary = `[RELEVANT PAST CONTEXT - ${retrievedMessages.length} messages retrieved based on similarity to your current query]`;
      messages.push(new SystemMessage(contextSummary));

      // Add retrieved messages
      for (const msg of retrievedMessages) {
        messages.push(this.toBaseMessage(msg));
      }

      // Add separator
      messages.push(new SystemMessage('[END PAST CONTEXT - Recent conversation continues below]'));
    }

    // Add recent messages (maintains conversation flow)
    for (const msg of recentMessages) {
      messages.push(this.toBaseMessage(msg));
    }

    // Add new query
    messages.push(new HumanMessage(newQuery));

    return messages;
  }

  /**
   * Store complete conversation turn (user message + agent response)
   */
  async storeConversationTurn(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    metadata?: Record<string, any>
  ): Promise<{ userMessageId: string; assistantMessageId: string }> {
    const userMessageId = await this.storeMessage(sessionId, 'user', userMessage, metadata);
    const assistantMessageId = await this.storeMessage(sessionId, 'assistant', assistantResponse, metadata);
    
    return { userMessageId, assistantMessageId };
  }

  /**
   * Delete all messages for a session
   */
  async clearSession(sessionId: string): Promise<number> {
    await this.initialize();

    const session = this.driver.session();
    
    try {
      const result = await session.run(`
        MATCH (m:ConversationMessage)
        WHERE m.sessionId = $sessionId
        DELETE m
        RETURN count(m) as deletedCount
      `, { sessionId });

      const deletedCount = result.records[0]?.get('deletedCount')?.toNumber() || 0;
      console.log(`🗑️  Cleared ${deletedCount} messages from session ${sessionId}`);
      return deletedCount;
    } finally {
      await session.close();
    }
  }

  /**
   * Get conversation statistics for a session
   */
  async getSessionStats(sessionId: string): Promise<{
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    embeddedMessages: number;
    oldestMessage: number | null;
    newestMessage: number | null;
  }> {
    await this.initialize();

    const session = this.driver.session();
    
    try {
      const result = await session.run(`
        MATCH (m:ConversationMessage)
        WHERE m.sessionId = $sessionId
        RETURN 
          count(m) as total,
          sum(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) as userCount,
          sum(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END) as assistantCount,
          sum(CASE WHEN m.embedding IS NOT NULL THEN 1 ELSE 0 END) as embeddedCount,
          min(m.timestamp) as oldest,
          max(m.timestamp) as newest
      `, { sessionId });

      const record = result.records[0];
      return {
        totalMessages: record.get('total').toNumber(),
        userMessages: record.get('userCount').toNumber(),
        assistantMessages: record.get('assistantCount').toNumber(),
        embeddedMessages: record.get('embeddedCount').toNumber(),
        oldestMessage: record.get('oldest')?.toNumber() || null,
        newestMessage: record.get('newest')?.toNumber() || null
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Convert Neo4j record to ConversationMessage
   */
  private recordToMessage(record: any): ConversationMessage {
    const properties = record.properties;
    return {
      id: properties.id,
      sessionId: properties.sessionId,
      role: properties.role,
      content: properties.content,
      timestamp: properties.timestamp?.toNumber() || Date.now(),
      embedding: properties.embedding || undefined,
      metadata: properties.metadata || {}
    };
  }

  /**
   * Convert ConversationMessage to LangChain BaseMessage
   */
  private toBaseMessage(msg: ConversationMessage): BaseMessage {
    switch (msg.role) {
      case 'system':
        return new SystemMessage(msg.content);
      case 'user':
        return new HumanMessage(msg.content);
      case 'assistant':
        return new AIMessage(msg.content);
      default:
        return new HumanMessage(msg.content);
    }
  }
}

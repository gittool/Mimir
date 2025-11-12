/**
 * @file src/tools/vectorSearch.tools.ts
 * @description Vector search MCP tools for semantic file search
 * Now uses UnifiedSearchService for automatic fallback to full-text search
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Driver } from 'neo4j-driver';
import { UnifiedSearchService } from '../managers/UnifiedSearchService.js';

export function createVectorSearchTools(driver: Driver): Tool[] {
  return [
    // ========================================================================
    // vector_search_nodes
    // ========================================================================
    {
      name: 'vector_search_nodes',
      description: 'Semantic search across all nodes using vector embeddings (with automatic fallback to full-text search). Returns nodes most similar to the query by MEANING (not exact text match). If embeddings are disabled or no results found, automatically falls back to keyword search. For files, searches individual chunks and returns parent file context. Use this to find related concepts, similar problems, or relevant context when you don\'t know exact keywords. Works with todos, memories, file chunks, and all other node types.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query (e.g., "authentication code", "database connections", "pending tasks")'
          },
          types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Filter by node types (e.g., ["todo", "memory", "file", "file_chunk"]). If not provided, searches all types.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
            default: 5
          },
          min_similarity: {
            type: 'number',
            description: 'Minimum cosine similarity threshold 0-1 (default: 0.5)',
            default: 0.5
          }
        },
        required: ['query']
      }
    },

    // ========================================================================
    // get_embedding_stats
    // ========================================================================
    {
      name: 'get_embedding_stats',
      description: 'Get statistics about nodes with embeddings, broken down by type',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
  ];
}

/**
 * Handle vector_search_nodes tool call
 * Uses UnifiedSearchService for automatic fallback
 */
export async function handleVectorSearchNodes(
  params: any,
  driver: Driver
): Promise<any> {
  const searchService = new UnifiedSearchService(driver);
  await searchService.initialize();
  
  try {
    const result = await searchService.search(params.query, {
      types: params.types,
      limit: params.limit || 10,
      minSimilarity: params.min_similarity || 0.5,
      offset: 0
    });
    
    return result;
    
  } catch (error: any) {
    return {
      status: 'error',
      message: error.message
    };
  }
}

/**
 * Handle get_embedding_stats tool call
 */
export async function handleGetEmbeddingStats(
  params: any,
  driver: Driver
): Promise<any> {
  const searchService = new UnifiedSearchService(driver);
  await searchService.initialize();
  
  const session = driver.session();
  
  try {
    // Get total count and breakdown by type (including FileChunk)
    // Match nodes with embeddings, but exclude system nodes like WatchConfig
    const result = await session.run(`
      MATCH (n)
      WHERE n.embedding IS NOT NULL 
        AND NOT n:WatchConfig
        AND n.type IS NOT NULL
      RETURN n.type AS type, count(*) AS count
      ORDER BY count DESC
    `);

    const byType: Record<string, number> = {};
    let total = 0;

    for (const record of result.records) {
      const type = record.get('type');
      const countValue = record.get('count');
      const count = typeof countValue === 'object' && countValue.toNumber ? countValue.toNumber() : Number(countValue);
      byType[type] = count;
      total += count;
    }

    return {
      status: 'success',
      embeddings_enabled: searchService.isEmbeddingsEnabled(),
      total_nodes_with_embeddings: total,
      breakdown_by_type: byType
    };

  } catch (error: any) {
    return {
      status: 'error',
      message: error.message
    };
  } finally {
    await session.close();
  }
}

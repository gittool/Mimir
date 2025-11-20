#!/usr/bin/env node
/**
 * Backfill Embeddings Script
 * Generates embeddings for all nodes in Neo4j that don't have them
 */

// Hardcode environment variables for embeddings (temporary - script will be removed after backfill)
process.env.MIMIR_EMBEDDINGS_ENABLED = 'true';
process.env.MIMIR_EMBEDDINGS_PROVIDER = 'llama.cpp';
process.env.MIMIR_EMBEDDINGS_MODEL = 'mxbai-embed-large';
process.env.MIMIR_EMBEDDINGS_API = 'http://localhost:11434';
process.env.MIMIR_EMBEDDINGS_API_PATH = '/v1/embeddings';
process.env.MIMIR_EMBEDDINGS_DIMENSIONS = '1024';
process.env.MIMIR_EMBEDDINGS_CHUNK_SIZE = '768';
process.env.MIMIR_EMBEDDINGS_CHUNK_OVERLAP = '50';
process.env.MIMIR_EMBEDDINGS_MAX_RETRIES = '3';  // More retries for stability
process.env.MIMIR_EMBEDDINGS_DELAY_MS = '1';  // 2 second delay to avoid overwhelming server

import neo4j from 'neo4j-driver';
import { EmbeddingsService } from '../indexing/EmbeddingsService.js';

// Helper to extract text content from node properties (matches GraphManager implementation)
function extractTextContent(properties: Record<string, any>): string {
  const parts: string[] = [];
  
  // Priority fields first
  if (properties.title && typeof properties.title === 'string') {
    parts.push(`Title: ${properties.title}`);
  }
  if (properties.name && typeof properties.name === 'string') {
    parts.push(`Name: ${properties.name}`);
  }
  if (properties.description && typeof properties.description === 'string') {
    parts.push(`Description: ${properties.description}`);
  }
  if (properties.content && typeof properties.content === 'string') {
    parts.push(`Content: ${properties.content}`);
  }
  
  // Now include ALL other properties (stringified)
  const systemFields = new Set(['id', 'type', 'created', 'updated', 'title', 'name', 'description', 'content', 
                                 'embedding', 'embedding_dimensions', 'embedding_model', 'has_embedding']);
  
  for (const [key, value] of Object.entries(properties)) {
    // Skip system fields and already-included fields
    if (systemFields.has(key)) {
      continue;
    }
    
    // Skip null/undefined
    if (value === null || value === undefined) {
      continue;
    }
    
    // Stringify the value
    let stringValue: string;
    if (typeof value === 'string') {
      stringValue = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      stringValue = String(value);
    } else if (Array.isArray(value)) {
      stringValue = value.join(', ');
    } else if (typeof value === 'object') {
      try {
        stringValue = JSON.stringify(value);
      } catch {
        stringValue = String(value);
      }
    } else {
      stringValue = String(value);
    }
    
    if (stringValue.trim().length > 0) {
      parts.push(`${key}: ${stringValue}`);
    }
  }
  
  return parts.join('\n');
}

// Helper to create chunks for a node (matches GraphManager implementation)
async function createNodeChunks(
  nodeId: string,
  textContent: string,
  session: any,
  embeddingsService: EmbeddingsService
): Promise<number> {
  console.log(`   📦 Creating chunks for ${nodeId} (${textContent.length} chars)...`);
  
  try {
    // Generate chunk embeddings
    const chunks = await embeddingsService.generateChunkEmbeddings(textContent);
    
    // Create chunk nodes and relationships
    for (const chunk of chunks) {
      const chunkId = `chunk-${nodeId}-${chunk.chunkIndex}`;
      
      await session.run(
        `
        MATCH (n:Node {id: $nodeId})
        MERGE (c:NodeChunk:Node {id: $chunkId})
        ON CREATE SET
          c.chunk_index = $chunkIndex,
          c.text = $text,
          c.start_offset = $startOffset,
          c.end_offset = $endOffset,
          c.embedding = $embedding,
          c.embedding_dimensions = $dimensions,
          c.embedding_model = $model,
          c.type = 'node_chunk',
          c.indexed_date = datetime(),
          c.parentNodeId = $nodeId,
          c.has_embedding = true
        ON MATCH SET
          c.chunk_index = $chunkIndex,
          c.text = $text,
          c.start_offset = $startOffset,
          c.end_offset = $endOffset,
          c.embedding = $embedding,
          c.embedding_dimensions = $dimensions,
          c.embedding_model = $model,
          c.indexed_date = datetime()
        MERGE (n)-[:HAS_CHUNK {index: $chunkIndex}]->(c)
        RETURN c.id AS chunk_id
        `,
        {
          nodeId,
          chunkId,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          embedding: chunk.embedding,
          dimensions: chunk.dimensions,
          model: chunk.model
        }
      );
    }
    
    console.log(`   ✅ Created ${chunks.length} chunks for ${nodeId}`);
    return chunks.length;
  } catch (error: any) {
    console.error(`   ⚠️  Failed to create chunks for ${nodeId}: ${error.message}`);
    throw error;
  }
}

async function backfillEmbeddings() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'password'
    )
  );

  const embeddingsService = new EmbeddingsService();
  
  try {
    console.log('🔄 Initializing embeddings service...');
    await embeddingsService.initialize();
    
    if (!embeddingsService.isEnabled()) {
      embeddingsService.enabled = true
    }
    
    console.log('✅ Embeddings service initialized');
    
    const session = driver.session();
    
    try {
      // Find all nodes without embeddings (excluding File and FileChunk which are handled during indexing)
      console.log('🔍 Finding nodes without embeddings...');
      const result = await session.run(`
        MATCH (n:Node)
        WHERE (n.has_embedding IS NULL OR n.has_embedding = false)
          AND n.type <> 'file'
          AND n.type <> 'file_chunk'
          AND n.type <> 'node_chunk'
        RETURN n.id AS id, n.type AS type, properties(n) AS props
        ORDER BY n.type, n.created
      `);
      
      const nodesWithoutEmbeddings = result.records.map(record => ({
        id: record.get('id'),
        type: record.get('type'),
        properties: record.get('props')
      }));
      
      console.log(`📊 Found ${nodesWithoutEmbeddings.length} nodes without embeddings`);
      
      if (nodesWithoutEmbeddings.length === 0) {
        console.log('✅ All nodes already have embeddings!');
        return;
      }
      
      // Group by type for better reporting
      const byType: Record<string, number> = {};
      for (const node of nodesWithoutEmbeddings) {
        byType[node.type] = (byType[node.type] || 0) + 1;
      }
      
      console.log('\n📋 Breakdown by type:');
      for (const [type, count] of Object.entries(byType)) {
        console.log(`   ${type}: ${count}`);
      }
      console.log('');
      
      let processed = 0;
      let succeeded = 0;
      let skipped = 0;
      let failed = 0;
      let chunked = 0;
      
      const chunkSize = parseInt(process.env.MIMIR_EMBEDDINGS_CHUNK_SIZE || '768', 10);
      
      // Process nodes one by one
      for (const node of nodesWithoutEmbeddings) {
        processed++;
        
        try {
          // Extract text content
          const textContent = extractTextContent(node.properties);
          
          if (!textContent || textContent.trim().length === 0) {
            console.log(`⏭️  [${processed}/${nodesWithoutEmbeddings.length}] Skipping ${node.type} (${node.id}) - no text content`);
            skipped++;
            continue;
          }
          
          // Check if content needs chunking
          if (textContent.length > chunkSize) {
            // Large content - use chunking
            console.log(`📦 [${processed}/${nodesWithoutEmbeddings.length}] ${node.type} (${node.id}) has large content (${textContent.length} chars), creating chunks...`);
            
            const chunkCount = await createNodeChunks(node.id, textContent, session, embeddingsService);
            
            // Update node to mark it has chunks
            await session.run(`
              MATCH (n:Node {id: $id})
              SET n.has_embedding = true, n.has_chunks = true
            `, {
              id: node.id
            });
            
            succeeded++;
            chunked++;
            console.log(`✅ [${processed}/${nodesWithoutEmbeddings.length}] Created ${chunkCount} chunks for ${node.type} (${node.id})`);
          } else {
            // Small content - single embedding
            const result = await embeddingsService.generateEmbedding(textContent);
            
            // Update node
            await session.run(`
              MATCH (n:Node {id: $id})
              SET n.embedding = $embedding,
                  n.embedding_dimensions = $dimensions,
                  n.embedding_model = $model,
                  n.has_embedding = true
            `, {
              id: node.id,
              embedding: result.embedding,
              dimensions: result.dimensions,
              model: result.model
            });
            
            succeeded++;
            console.log(`✅ [${processed}/${nodesWithoutEmbeddings.length}] Generated single embedding for ${node.type} (${node.id}) - ${result.dimensions} dims`);
          }
          
          // Small delay to avoid overwhelming the embedding service
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error: any) {
          failed++;
          console.error(`❌ [${processed}/${nodesWithoutEmbeddings.length}] Failed for ${node.type} (${node.id}): ${error.message}`);
        }
      }
      
      console.log('\n' + '='.repeat(60));
      console.log('📊 Backfill Summary:');
      console.log(`   Total nodes: ${nodesWithoutEmbeddings.length}`);
      console.log(`   ✅ Succeeded: ${succeeded}`);
      console.log(`      - Single embeddings: ${succeeded - chunked}`);
      console.log(`      - Chunked (large content): ${chunked}`);
      console.log(`   ⏭️  Skipped (no text): ${skipped}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log('='.repeat(60) + '\n');
      
    } finally {
      await session.close();
    }
    
  } finally {
    await driver.close();
  }
}

// Run the script
backfillEmbeddings()
  .then(() => {
    console.log('✅ Backfill complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  });

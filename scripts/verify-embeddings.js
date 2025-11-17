#!/usr/bin/env node

/**
 * Verify Embedding Data Integrity
 * Run this before check-and-reset-embeddings.js to verify what will be processed
 */

import neo4j from 'neo4j-driver';

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';
const CONFIGURED_DIMENSIONS = parseInt(process.env.MIMIR_EMBEDDINGS_DIMENSIONS || '1024', 10);
const CONFIGURED_MODEL = process.env.MIMIR_EMBEDDINGS_MODEL || 'mxbai-embed-large';

async function main() {
  console.log('🔍 Embedding Data Integrity Verification\n');
  console.log('Configuration:');
  console.log(`   Dimensions: ${CONFIGURED_DIMENSIONS}`);
  console.log(`   Model: ${CONFIGURED_MODEL}\n`);
  
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session();
  
  try {
    // Query 1: Overview
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('1. OVERVIEW - Nodes with embeddings');
    console.log('═══════════════════════════════════════════════════════════════');
    
    const overview = await session.run(`
      MATCH (n:Node)
      WHERE n.embedding IS NOT NULL
      RETURN 
        count(n) as total,
        count(DISTINCT n.type) as distinctTypes,
        count(CASE WHEN n.id IS NULL THEN 1 END) as nullIds,
        count(CASE WHEN n.embedding_dimensions IS NULL THEN 1 END) as nullDimensions,
        count(CASE WHEN n.embedding_model IS NULL THEN 1 END) as nullModels
    `);
    
    const o = overview.records[0];
    console.log(`   Total nodes with embeddings: ${o.get('total')}`);
    console.log(`   Distinct types: ${o.get('distinctTypes')}`);
    console.log(`   Nodes with NULL IDs: ${o.get('nullIds')}`);
    console.log(`   Nodes with NULL dimensions: ${o.get('nullDimensions')}`);
    console.log(`   Nodes with NULL models: ${o.get('nullModels')}`);
    
    // Query 2: Breakdown by model/dimensions (what script sees)
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('2. BREAKDOWN - By model and dimensions (script view)');
    console.log('═══════════════════════════════════════════════════════════════');
    
    const breakdown = await session.run(`
      MATCH (n:Node)
      WHERE n.embedding IS NOT NULL
      RETURN 
        n.embedding_model as model,
        n.embedding_dimensions as dimensions,
        count(n) as count
      ORDER BY count DESC
    `);
    
    breakdown.records.forEach(r => {
      const model = r.get('model') || 'NULL';
      const dims = r.get('dimensions') || 'NULL';
      const count = r.get('count');
      const match = model === CONFIGURED_MODEL && dims === CONFIGURED_DIMENSIONS ? '✅' : '⚠️ ';
      console.log(`   ${match} ${model} (${dims} dims): ${count} nodes`);
    });
    
    // Query 3: Mismatched nodes (EXACT script logic)
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('3. MISMATCHED NODES - Exact script query');
    console.log('═══════════════════════════════════════════════════════════════');
    
    const mismatched = await session.run(`
      MATCH (n:Node)
      WHERE n.embedding IS NOT NULL 
        AND (n.embedding_dimensions IS NULL 
             OR n.embedding_dimensions <> $configuredDims
             OR n.embedding_model <> $configuredModel)
      RETURN 
        count(n) as mismatchedCount,
        collect(DISTINCT n.type) as types,
        collect(DISTINCT n.embedding_model) as models,
        collect(DISTINCT n.embedding_dimensions) as dimensions
    `, { configuredDims: CONFIGURED_DIMENSIONS, configuredModel: CONFIGURED_MODEL });
    
    const m = mismatched.records[0];
    const mCount = m.get('mismatchedCount');
    console.log(`   Will process: ${mCount} nodes`);
    console.log(`   Types: ${m.get('types').join(', ')}`);
    console.log(`   Current models: ${m.get('models').join(', ')}`);
    console.log(`   Current dimensions: ${m.get('dimensions').join(', ')}`);
    
    // Query 4: Alternative query (double-check)
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('4. VERIFICATION - Alternative query method');
    console.log('═══════════════════════════════════════════════════════════════');
    
    const alternative = await session.run(`
      MATCH (n:Node)
      WHERE n.embedding IS NOT NULL
      WITH n, 
           n.embedding_dimensions <> $configuredDims OR n.embedding_dimensions IS NULL as wrongDims,
           n.embedding_model <> $configuredModel OR n.embedding_model IS NULL as wrongModel
      WHERE wrongDims OR wrongModel
      RETURN 
        count(n) as alternativeCount,
        sum(CASE WHEN wrongDims THEN 1 ELSE 0 END) as wrongDimsCount,
        sum(CASE WHEN wrongModel THEN 1 ELSE 0 END) as wrongModelCount
    `, { configuredDims: CONFIGURED_DIMENSIONS, configuredModel: CONFIGURED_MODEL });
    
    const a = alternative.records[0];
    const altCount = a.get('alternativeCount');
    console.log(`   Alternative count: ${altCount} nodes`);
    console.log(`   Wrong dimensions: ${a.get('wrongDimsCount')}`);
    console.log(`   Wrong model: ${a.get('wrongModelCount')}`);
    
    if (altCount !== mCount) {
      console.log(`   ⚠️  WARNING: Counts don't match! (${mCount} vs ${altCount})`);
    } else {
      console.log(`   ✅ Query results match`);
    }
    
    // Query 5: Detailed breakdown by type
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('5. BREAKDOWN - Mismatched nodes by type');
    console.log('═══════════════════════════════════════════════════════════════');
    
    const detailed = await session.run(`
      MATCH (n:Node)
      WHERE n.embedding IS NOT NULL 
        AND (n.embedding_dimensions IS NULL 
             OR n.embedding_dimensions <> $configuredDims
             OR n.embedding_model <> $configuredModel)
      RETURN 
        n.type as nodeType,
        n.embedding_model as currentModel,
        n.embedding_dimensions as currentDims,
        count(n) as count,
        count(CASE WHEN n.id IS NULL THEN 1 END) as nullIds,
        count(CASE WHEN n.title IS NULL AND n.content IS NULL AND n.text IS NULL THEN 1 END) as noContent
      ORDER BY count DESC
    `, { configuredDims: CONFIGURED_DIMENSIONS, configuredModel: CONFIGURED_MODEL });
    
    detailed.records.forEach(r => {
      const type = r.get('nodeType');
      const model = r.get('currentModel') || 'NULL';
      const dims = r.get('currentDims') || 'NULL';
      const count = r.get('count');
      const nullIds = r.get('nullIds');
      const noContent = r.get('noContent');
      
      console.log(`   ${type}: ${count} nodes (${model}, ${dims} dims)`);
      if (nullIds > 0) console.log(`      ⚠️  ${nullIds} with NULL IDs (will skip)`);
      if (noContent > 0) console.log(`      ⚠️  ${noContent} with no content (will fail)`);
    });
    
    // Query 6: Nodes that will fail
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('6. PROBLEMATIC NODES - Will fail during regeneration');
    console.log('═══════════════════════════════════════════════════════════════');
    
    const problematic = await session.run(`
      MATCH (n:Node)
      WHERE n.embedding IS NOT NULL
        AND (n.embedding_dimensions IS NULL 
             OR n.embedding_dimensions <> $configuredDims
             OR n.embedding_model <> $configuredModel)
        AND (n.id IS NULL 
             OR (n.title IS NULL AND n.content IS NULL AND n.text IS NULL))
      RETURN 
        count(CASE WHEN n.id IS NULL THEN 1 END) as nullIdCount,
        count(CASE WHEN n.title IS NULL AND n.content IS NULL AND n.text IS NULL THEN 1 END) as noContentCount,
        count(n) as totalProblematic
    `, { configuredDims: CONFIGURED_DIMENSIONS, configuredModel: CONFIGURED_MODEL });
    
    const p = problematic.records[0];
    const pTotal = p.get('totalProblematic');
    const pNullId = p.get('nullIdCount');
    const pNoContent = p.get('noContentCount');
    
    console.log(`   Total problematic: ${pTotal} nodes`);
    console.log(`   NULL IDs: ${pNullId} (will be skipped)`);
    console.log(`   No content: ${pNoContent} (will fail)`);
    
    // Query 7: Sample nodes
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('7. SAMPLE - First 10 nodes to be processed');
    console.log('═══════════════════════════════════════════════════════════════');
    
    const samples = await session.run(`
      MATCH (n:Node)
      WHERE n.embedding IS NOT NULL 
        AND (n.embedding_dimensions IS NULL 
             OR n.embedding_dimensions <> $configuredDims
             OR n.embedding_model <> $configuredModel)
      RETURN 
        n.id as id,
        n.type as type,
        n.title as title,
        n.embedding_model as currentModel,
        n.embedding_dimensions as currentDims,
        size(n.embedding) as actualEmbeddingSize,
        CASE 
          WHEN n.content IS NOT NULL THEN 'content'
          WHEN n.text IS NOT NULL THEN 'text'
          WHEN n.title IS NOT NULL THEN 'title'
          ELSE 'NONE'
        END as textSource
      ORDER BY n.type, n.id
      LIMIT 10
    `, { configuredDims: CONFIGURED_DIMENSIONS, configuredModel: CONFIGURED_MODEL });
    
    samples.records.forEach((r, i) => {
      const id = r.get('id') || 'NULL';
      const type = r.get('type');
      const title = r.get('title');
      const model = r.get('currentModel') || 'NULL';
      const dims = r.get('currentDims') || 'NULL';
      const actualSize = r.get('actualEmbeddingSize');
      const textSource = r.get('textSource');
      
      console.log(`   ${i + 1}. ${type} - ${id}`);
      if (title) console.log(`      Title: ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`);
      console.log(`      Current: ${model} (${dims} dims, actual: ${actualSize})`);
      console.log(`      Text source: ${textSource}`);
    });
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`   Total nodes with embeddings: ${o.get('total')}`);
    console.log(`   Will process: ${mCount} nodes`);
    console.log(`   Will skip (NULL ID): ${pNullId} nodes`);
    console.log(`   Will fail (no content): ${pNoContent} nodes`);
    console.log(`   Expected success: ${mCount - pNullId - pNoContent} nodes`);
    
    if (pNullId > 0) {
      console.log(`\n💡 Fix NULL IDs first:`);
      console.log(`   MATCH (n:Node) WHERE n.id IS NULL`);
      console.log(`   SET n.id = n.type + '-' + toString(timestamp())`);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await session.close();
    await driver.close();
  }
}

main()
  .then(() => {
    console.log('\n✅ Verification complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

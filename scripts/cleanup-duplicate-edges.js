#!/usr/bin/env node
/**
 * Cleanup Duplicate Edges Script
 * Finds and removes duplicate relationships between nodes in Neo4j
 * 
 * Usage:
 *   node scripts/cleanup-duplicate-edges.js [--dry-run]
 * 
 * Options:
 *   --dry-run    Show what would be deleted without actually deleting
 */

import neo4j from 'neo4j-driver';

const isDryRun = process.argv.includes('--dry-run');

async function findDuplicates(session) {
  console.log('\n🔍 Scanning for duplicate edges...\n');
  
  const result = await session.run(`
    MATCH (source)-[r]->(target)
    WITH source, target, type(r) as relType, collect(r) as rels, collect(id(r)) as relIds
    WHERE size(rels) > 1
    RETURN 
      id(source) as sourceId,
      labels(source) as sourceLabels,
      COALESCE(source.path, source.id, source.name) as sourceName,
      id(target) as targetId,
      labels(target) as targetLabels,
      COALESCE(target.path, target.id, target.name) as targetName,
      relType,
      size(rels) as duplicateCount,
      relIds
    ORDER BY duplicateCount DESC
  `);
  
  if (result.records.length === 0) {
    console.log('✅ No duplicate edges found!\n');
    return [];
  }
  
  console.log(`📊 Found ${result.records.length} sets of duplicate edges:\n`);
  
  const duplicates = result.records.map(record => {
    const sourceLabels = record.get('sourceLabels').join(':');
    const targetLabels = record.get('targetLabels').join(':');
    const sourceName = record.get('sourceName');
    const targetName = record.get('targetName');
    const relType = record.get('relType');
    const count = record.get('duplicateCount').toInt();
    const relIds = record.get('relIds').map(id => id.toInt());
    
    console.log(`   ${sourceLabels} → [${relType}] → ${targetLabels}`);
    console.log(`   Source: ${sourceName || '(no name)'}`);
    console.log(`   Target: ${targetName || '(no name)'}`);
    console.log(`   Duplicates: ${count} edges (${count - 1} will be removed)`);
    console.log(`   Edge IDs: ${relIds.join(', ')}`);
    console.log('');
    
    return {
      sourceId: record.get('sourceId').toInt(),
      targetId: record.get('targetId').toInt(),
      relType,
      duplicateCount: count,
      relIds
    };
  });
  
  return duplicates;
}

async function cleanupDuplicates(session) {
  console.log('\n🧹 Removing duplicate edges (keeping first edge of each set)...\n');
  
  const result = await session.run(`
    MATCH (source)-[r]->(target)
    WITH source, target, type(r) as relType, collect(r) as rels
    WHERE size(rels) > 1
    WITH source, target, relType, rels
    UNWIND rels[1..] as duplicateRel
    DELETE duplicateRel
    RETURN count(*) as deletedCount
  `);
  
  const deletedCount = result.records[0].get('deletedCount').toInt();
  console.log(`✅ Deleted ${deletedCount} duplicate edges\n`);
  
  return deletedCount;
}

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'password'
    )
  );
  
  const session = driver.session();
  
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Mimir - Duplicate Edge Cleanup Utility');
    console.log('═══════════════════════════════════════════════════════════');
    
    if (isDryRun) {
      console.log('\n⚠️  DRY RUN MODE - No changes will be made\n');
    }
    
    // Find duplicates
    const duplicates = await findDuplicates(session);
    
    if (duplicates.length === 0) {
      return;
    }
    
    // Calculate statistics
    const totalDuplicateEdges = duplicates.reduce((sum, d) => sum + (d.duplicateCount - 1), 0);
    const byType = duplicates.reduce((acc, d) => {
      acc[d.relType] = (acc[d.relType] || 0) + (d.duplicateCount - 1);
      return acc;
    }, {});
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📈 Summary');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Total duplicate edges to remove: ${totalDuplicateEdges}`);
    console.log(`   Edge sets with duplicates: ${duplicates.length}`);
    console.log('\n   By relationship type:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`      ${type}: ${count}`);
    });
    console.log('');
    
    if (isDryRun) {
      console.log('ℹ️  Run without --dry-run to perform cleanup');
      console.log('');
      return;
    }
    
    // Confirm before proceeding
    console.log('⚠️  This will permanently delete duplicate edges!');
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Perform cleanup
    const deletedCount = await cleanupDuplicates(session);
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Cleanup Complete!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Removed ${deletedCount} duplicate edges`);
    console.log('   Database is now clean\n');
    
    // Run verification
    console.log('🔍 Verifying cleanup...\n');
    const remainingDuplicates = await findDuplicates(session);
    
    if (remainingDuplicates.length === 0) {
      console.log('✅ Verification passed - no duplicates remain!\n');
    } else {
      console.log(`⚠️  Warning: ${remainingDuplicates.length} duplicate sets still exist`);
      console.log('   You may need to run the script again\n');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await session.close();
    await driver.close();
  }
}

main()
  .then(() => {
    console.log('Done!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

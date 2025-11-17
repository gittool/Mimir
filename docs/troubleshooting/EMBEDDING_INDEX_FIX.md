# Neo4j Vector Index & Embedding Issue - Fix Guide

## Problem Summary

The Neo4j vector index `node_embedding_index` was configured to only index nodes with the `:Node` label, but many nodes in the database were created with only type-specific labels (`:memory`, `:preamble`, `:todo`, `:todoList`, `:FileChunk`) without the `:Node` label. This caused:

1. **Vector search not finding most nodes** - Only 41 out of 3,573 nodes were searchable
2. **Missing embeddings on FileChunks** - 3,069 FileChunk nodes had no embeddings at all
3. **Inconsistent data model** - Old nodes used type as label, new code creates `:Node` label properly

## Root Cause

**Historical Data Issue**: Older code created nodes with only type-specific labels:
- `CREATE (n:memory {...})` 
- `CREATE (n:preamble {...})`
- `CREATE (n:todo {...})`

**Current Code (Correct)**: Modern code creates all nodes with `:Node` label:
- `CREATE (n:Node {...})` in `GraphManager.ts` line 296
- `MERGE (f:File:Node {...})` in `FileIndexer.ts` line 121
- `CREATE (c:FileChunk:Node)` in `FileIndexer.ts` line 170

**Vector Index Limitation**: The index only covers `:Node` labeled nodes:
```cypher
// Current index configuration
CREATE VECTOR INDEX node_embedding_index FOR (n:Node) ON (n.embedding)
OPTIONS {indexConfig: {`vector.dimensions`: 1024, `vector.similarity_function`: "COSINE"}}
```

## Diagnosis Commands

Check your database status with these commands:

```bash
# Find Neo4j container name
docker ps --format "{{.Names}}" | grep neo4j

# Count total nodes with Node label
echo "MATCH (n:Node) RETURN count(n) as total;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# Count nodes with embeddings
echo "MATCH (n) WHERE n.embedding IS NOT NULL RETURN count(n) as withEmbedding;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# Check all labels in database
echo "CALL db.labels() YIELD label RETURN label ORDER BY label;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# Check vector index configuration
echo "SHOW INDEXES YIELD name, labelsOrTypes, properties, type WHERE type = 'VECTOR' RETURN name, labelsOrTypes, properties;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# Check distribution of nodes by label
echo "MATCH (n) WHERE n.embedding IS NOT NULL RETURN DISTINCT labels(n) as labels, count(*) as count ORDER BY count DESC;" | docker exec -i <container_name> cypher-shell -u neo4j -p password
```

## Fix: Migrate Old Data

Run these Cypher commands to add `:Node` label to all nodes (replace `<container_name>` with your Neo4j container):

```bash
# 1. Add Node label to all memory nodes
echo "MATCH (n:memory) WHERE NOT n:Node SET n:Node RETURN count(n) as updated;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# 2. Add Node label to all preamble nodes
echo "MATCH (n:preamble) WHERE NOT n:Node SET n:Node RETURN count(n) as updated;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# 3. Add Node label to all todo/todoList nodes
echo "MATCH (n) WHERE (n:todo OR n:todoList) AND NOT n:Node SET n:Node RETURN count(n) as updated;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# 4. Add Node label to all FileChunk nodes (if needed)
echo "MATCH (n:FileChunk) WHERE NOT n:Node SET n:Node RETURN count(n) as updated;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# 5. Add Node label to all File nodes (if needed)
echo "MATCH (n:File) WHERE NOT n:Node SET n:Node RETURN count(n) as updated;" | docker exec -i <container_name> cypher-shell -u neo4j -p password
```

## Verification

After migration, verify the fix:

```bash
# Check total nodes with Node label
echo "MATCH (n:Node) RETURN count(n) as total;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# Check embedding coverage
echo "MATCH (n:Node) RETURN count(n) as total, count(n.embedding) as withEmbedding, count(n.embedding) * 100.0 / count(n) as percentWithEmbedding;" | docker exec -i <container_name> cypher-shell -u neo4j -p password

# Check FileChunk status
echo "MATCH (fc:FileChunk) RETURN count(fc) as total, count(fc.embedding) as withEmbedding;" | docker exec -i <container_name> cypher-shell -u neo4j -p password
```

**Expected Results After Migration:**
- All nodes should have `:Node` label
- Vector index can now find all nodes
- Most nodes will still need embeddings generated

## Generate Missing Embeddings

After fixing the label issue, generate embeddings for nodes that don't have them:

```bash
# 1. Check current embedding status
npm run embeddings:check

# 2. Generate embeddings for all nodes/chunks without them
npm run embeddings:generate
```

The generation script will:
- Find all `:Node` labeled nodes without embeddings
- Include both regular nodes (memory, todo, preamble) and FileChunks
- Generate embeddings using the configured model (mxbai-embed-large)
- Store embeddings in the database
- Show progress and verification statistics

**Note**: For 3,000+ nodes, this may take 30-60 minutes depending on your embeddings service performance.

## Prevention: Code Already Fixed

The current codebase is correct and prevents this issue:

**✅ Correct patterns already in use:**
- `GraphManager.addNode()` creates all nodes with `:Node` label (line 296)
- `FileIndexer` creates `File:Node` and `FileChunk:Node` labels (lines 121, 170)
- All new nodes will automatically have the `:Node` label

**No code changes needed** - just migrate the old data once.

## Summary of What Changed

### Before Migration
```
Total Nodes: 3,573
- With :Node label: 3,279
- Without :Node label: 294 (not searchable)
- With embeddings: 134 (3.75%)
- FileChunks without embeddings: 3,069
```

### After Migration
```
Total Nodes: 3,573
- With :Node label: 3,573 ✅
- Without :Node label: 0 ✅
- With embeddings: 134 (3.75%)
- Need embeddings: 3,439 (96.25%)
```

### After Generating Embeddings
```
Total Nodes: 3,573
- With :Node label: 3,573 ✅
- With embeddings: 3,573 (100%) ✅
- Vector search: Fully functional ✅
```

## Troubleshooting

### If nodes still not searchable after migration:
1. Verify `:Node` label was added: `MATCH (n) WHERE NOT n:Node RETURN count(n);` should return 0
2. Check vector index exists: `SHOW INDEXES WHERE type = 'VECTOR';`
3. Verify embeddings exist: `MATCH (n:Node) WHERE n.embedding IS NULL RETURN count(n);`

### If embedding generation fails:
1. Check embeddings service is running: `docker ps | grep llama`
2. Verify service URL: `echo $MIMIR_EMBEDDINGS_SERVICE_URL`
3. Check logs: `docker logs mimir-server`
4. Test embedding service directly: `curl http://localhost:11434/api/embeddings -d '{"model":"mxbai-embed-large","prompt":"test"}'`

### If FileChunks still missing embeddings:
1. FileChunks use `text` property, not `content`
2. The generation script now handles both: `coalesce(n.content, n.text)`
3. Run check to verify: `npm run embeddings:check`

## Additional Resources

- **Vector Index Documentation**: Neo4j Vector Search documentation
- **Embeddings Configuration**: `src/indexing/EmbeddingsService.ts`
- **GraphManager Implementation**: `src/managers/GraphManager.ts`
- **FileIndexer Implementation**: `src/indexing/FileIndexer.ts`
- **Embedding Scripts**: `scripts/check-and-reset-embeddings.js`

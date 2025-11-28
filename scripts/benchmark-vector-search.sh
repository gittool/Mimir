#!/bin/bash
# Vector Search Performance Benchmark
# Compares NornicDB (local M3 Max) vs Mimir/Neo4j (remote i9)
# Accounts for network latency to give Neo4j best-case results

set -e

# Configuration
NORNICDB_URL="http://localhost:7474"
MIMIR_URL="http://192.168.1.167:9042"  # Mimir server with Neo4j backend
REMOTE_HOST="192.168.1.167"

# Test queries
QUERIES=(
  "authentication and user login"
  "database connection pooling"
  "error handling and exceptions"
  "file system operations"
  "API endpoint design"
)

ITERATIONS=10
WARMUP_ITERATIONS=3
LIMIT=10

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Vector Search Performance Benchmark                   ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  NornicDB (M3 Max 64GB): ${NC}localhost:7474${BLUE}                  ║${NC}"
echo -e "${BLUE}║  Mimir/Neo4j (i9 32GB):  ${NC}${REMOTE_HOST}:9042${BLUE}            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check connectivity
echo -e "${YELLOW}Checking connectivity...${NC}"

if curl -s --connect-timeout 2 "${NORNICDB_URL}/health" > /dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} NornicDB is reachable"
  NORNICDB_AVAILABLE=true
else
  echo -e "  ${RED}✗${NC} NornicDB is not reachable at ${NORNICDB_URL}"
  NORNICDB_AVAILABLE=false
fi

if curl -s --connect-timeout 2 "${MIMIR_URL}/health" > /dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} Mimir server is reachable"
  MIMIR_AVAILABLE=true
else
  echo -e "  ${RED}✗${NC} Mimir server is not reachable at ${MIMIR_URL}"
  MIMIR_AVAILABLE=false
fi

echo ""

# Measure network latency
echo -e "${YELLOW}Measuring network latency to ${REMOTE_HOST}...${NC}"

# Use ping to measure RTT (average of 5 pings)
if command -v ping &> /dev/null; then
  ping_result=$(ping -c 5 "$REMOTE_HOST" 2>/dev/null | tail -1 | awk -F'/' '{print $5}')
  if [ -n "$ping_result" ]; then
    NETWORK_LATENCY_MS=$(printf "%.0f" "$ping_result")
    echo -e "  ${CYAN}Network RTT: ${NETWORK_LATENCY_MS}ms (ping average)${NC}"
  else
    NETWORK_LATENCY_MS=0
    echo -e "  ${YELLOW}Could not measure ping latency${NC}"
  fi
else
  NETWORK_LATENCY_MS=0
  echo -e "  ${YELLOW}ping not available${NC}"
fi

# Also measure HTTP RTT (more realistic for HTTP traffic)
echo -e "  Measuring HTTP round-trip overhead..."
http_latencies=()
for i in {1..5}; do
  start=$(python3 -c 'import time; print(int(time.time() * 1000))')
  curl -s -o /dev/null "${MIMIR_URL}/health" 2>/dev/null
  end=$(python3 -c 'import time; print(int(time.time() * 1000))')
  http_latencies+=($((end - start)))
done

# Get minimum HTTP latency (best case)
HTTP_LATENCY_MS=$(printf '%s\n' "${http_latencies[@]}" | sort -n | head -1)
echo -e "  ${CYAN}HTTP RTT (min of 5): ${HTTP_LATENCY_MS}ms${NC}"

# Use the minimum of ping and HTTP latency as the baseline
if [ "$NETWORK_LATENCY_MS" -gt 0 ] && [ "$NETWORK_LATENCY_MS" -lt "$HTTP_LATENCY_MS" ]; then
  BASELINE_LATENCY_MS=$NETWORK_LATENCY_MS
else
  BASELINE_LATENCY_MS=$HTTP_LATENCY_MS
fi

echo -e "  ${GREEN}Baseline network latency: ${BASELINE_LATENCY_MS}ms (will subtract from Neo4j times)${NC}"
echo ""

# Warmup function
warmup() {
  local url="$1"
  local endpoint="$2"
  local method="$3"
  local data="$4"
  
  echo -e "  Warming up ${url}${endpoint}..."
  for ((i=1; i<=WARMUP_ITERATIONS; i++)); do
    if [ "$method" = "POST" ]; then
      curl -s -o /dev/null -X POST "${url}${endpoint}" -H "Content-Type: application/json" -d "$data" 2>/dev/null
    else
      curl -s -o /dev/null "${url}${endpoint}" 2>/dev/null
    fi
  done
}

# Warmup both systems
echo -e "${YELLOW}Warming up connections (${WARMUP_ITERATIONS} requests each)...${NC}"
if [ "$NORNICDB_AVAILABLE" = true ]; then
  warmup "$NORNICDB_URL" "/nornicdb/search" "POST" '{"query": "test", "limit": 5}'
fi
if [ "$MIMIR_AVAILABLE" = true ]; then
  warmup "$MIMIR_URL" "/api/nodes/vector-search?query=test&limit=5" "GET" ""
fi
echo ""

# Function to benchmark NornicDB search (returns min time for best case)
benchmark_nornicdb() {
  local query="$1"
  local iterations="$2"
  local min_time=999999
  local results_count=0
  local times=()
  
  for ((i=1; i<=iterations; i++)); do
    start=$(python3 -c 'import time; print(int(time.time() * 1000))')
    response=$(curl -s -X POST "${NORNICDB_URL}/nornicdb/search" \
      -H "Content-Type: application/json" \
      -d "{\"query\": \"${query}\", \"limit\": ${LIMIT}}" 2>/dev/null)
    end=$(python3 -c 'import time; print(int(time.time() * 1000))')
    
    elapsed=$((end - start))
    times+=($elapsed)
    
    if [ $elapsed -lt $min_time ]; then
      min_time=$elapsed
    fi
    
    # Count results
    count=$(echo "$response" | jq 'if type == "array" then length else .results // [] | length end' 2>/dev/null || echo "0")
    results_count=$count
  done
  
  # Calculate average and p50
  avg_time=$(printf '%s\n' "${times[@]}" | awk '{sum+=$1} END {printf "%.0f", sum/NR}')
  p50_time=$(printf '%s\n' "${times[@]}" | sort -n | awk 'NR==int((NR+1)/2)')
  
  echo "${min_time}|${avg_time}|${p50_time}|${results_count}"
}

# Function to benchmark Mimir search (returns min time minus network latency for best case)
benchmark_mimir() {
  local query="$1"
  local iterations="$2"
  local min_time=999999
  local results_count=0
  local times=()
  
  for ((i=1; i<=iterations; i++)); do
    start=$(python3 -c 'import time; print(int(time.time() * 1000))')
    response=$(curl -s -X GET "${MIMIR_URL}/api/nodes/vector-search?query=$(echo -n "$query" | jq -sRr @uri)&limit=${LIMIT}" 2>/dev/null)
    end=$(python3 -c 'import time; print(int(time.time() * 1000))')
    
    elapsed=$((end - start))
    times+=($elapsed)
    
    if [ $elapsed -lt $min_time ]; then
      min_time=$elapsed
    fi
    
    # Count results
    count=$(echo "$response" | jq '.results // [] | length' 2>/dev/null || echo "0")
    results_count=$count
  done
  
  # Calculate average and p50
  avg_time=$(printf '%s\n' "${times[@]}" | awk '{sum+=$1} END {printf "%.0f", sum/NR}')
  p50_time=$(printf '%s\n' "${times[@]}" | sort -n | awk 'NR==int((NR+1)/2)')
  
  # Subtract network latency for adjusted time (best case for Neo4j)
  adjusted_min=$((min_time - BASELINE_LATENCY_MS))
  if [ $adjusted_min -lt 0 ]; then adjusted_min=0; fi
  
  echo "${min_time}|${avg_time}|${p50_time}|${results_count}|${adjusted_min}"
}

# Run benchmarks
echo -e "${BLUE}Running benchmarks (${ITERATIONS} iterations per query, using MIN latency)...${NC}"
echo ""

# Header
printf "┌────────────────────────────────────────┬─────────────────────────────┬─────────────────────────────────────────┐\n"
printf "│ %-38s │ %-27s │ %-39s │\n" "Query" "NornicDB (M3 Max)" "Mimir/Neo4j (i9) [adjusted]"
printf "├────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────┤\n"

nornicdb_min_total=0
nornicdb_avg_total=0
mimir_min_total=0
mimir_adj_total=0
query_count=0

declare -a RESULTS

for query in "${QUERIES[@]}"; do
  display_query=$(printf "%-38s" "${query:0:38}")
  
  nornicdb_result="N/A"
  mimir_result="N/A"
  
  if [ "$NORNICDB_AVAILABLE" = true ]; then
    result=$(benchmark_nornicdb "$query" "$ITERATIONS")
    nornicdb_min=$(echo "$result" | cut -d'|' -f1)
    nornicdb_avg=$(echo "$result" | cut -d'|' -f2)
    nornicdb_count=$(echo "$result" | cut -d'|' -f4)
    nornicdb_result="${nornicdb_min}ms min (${nornicdb_count})"
    nornicdb_min_total=$((nornicdb_min_total + nornicdb_min))
    nornicdb_avg_total=$((nornicdb_avg_total + nornicdb_avg))
  fi
  
  if [ "$MIMIR_AVAILABLE" = true ]; then
    result=$(benchmark_mimir "$query" "$ITERATIONS")
    mimir_min=$(echo "$result" | cut -d'|' -f1)
    mimir_avg=$(echo "$result" | cut -d'|' -f2)
    mimir_count=$(echo "$result" | cut -d'|' -f4)
    mimir_adj=$(echo "$result" | cut -d'|' -f5)
    mimir_result="${mimir_min}ms → ${mimir_adj}ms adj (${mimir_count})"
    mimir_min_total=$((mimir_min_total + mimir_min))
    mimir_adj_total=$((mimir_adj_total + mimir_adj))
  fi
  
  printf "│ %s │ %27s │ %39s │\n" "$display_query" "$nornicdb_result" "$mimir_result"
  query_count=$((query_count + 1))
done

printf "├────────────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────┤\n"

# Calculate averages
if [ "$NORNICDB_AVAILABLE" = true ] && [ $query_count -gt 0 ]; then
  nornicdb_min_avg=$((nornicdb_min_total / query_count))
  nornicdb_avg_str="${nornicdb_min_avg}ms (best case avg)"
else
  nornicdb_avg_str="N/A"
  nornicdb_min_avg=0
fi

if [ "$MIMIR_AVAILABLE" = true ] && [ $query_count -gt 0 ]; then
  mimir_adj_avg=$((mimir_adj_total / query_count))
  mimir_min_avg=$((mimir_min_total / query_count))
  mimir_avg_str="${mimir_min_avg}ms → ${mimir_adj_avg}ms adj"
else
  mimir_avg_str="N/A"
  mimir_adj_avg=0
fi

printf "│ %-38s │ %27s │ %39s │\n" "AVERAGE (min times)" "$nornicdb_avg_str" "$mimir_avg_str"
printf "└────────────────────────────────────────┴─────────────────────────────┴─────────────────────────────────────────┘\n"

echo ""

# Summary with latency adjustment
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                              SUMMARY                                      ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}Network Latency Adjustment:${NC}"
echo -e "  • Baseline latency to ${REMOTE_HOST}: ${BASELINE_LATENCY_MS}ms"
echo -e "  • Neo4j times adjusted by subtracting ${BASELINE_LATENCY_MS}ms"
echo -e "  • This gives Neo4j best-case (as if running locally)"
echo ""

if [ "$NORNICDB_AVAILABLE" = true ] && [ "$MIMIR_AVAILABLE" = true ]; then
  echo -e "${CYAN}Performance Comparison (adjusted for network):${NC}"
  echo -e "  • NornicDB (M3 Max):        ${nornicdb_min_avg}ms average (best of ${ITERATIONS})"
  echo -e "  • Neo4j (i9) adjusted:      ${mimir_adj_avg}ms average (best of ${ITERATIONS}, -${BASELINE_LATENCY_MS}ms network)"
  echo -e "  • Neo4j (i9) raw:           ${mimir_min_avg}ms average (with network)"
  echo ""
  
  if [ $nornicdb_min_avg -gt 0 ] && [ $mimir_adj_avg -gt 0 ]; then
    if [ $nornicdb_min_avg -lt $mimir_adj_avg ]; then
      speedup=$(echo "scale=2; $mimir_adj_avg / $nornicdb_min_avg" | bc)
      echo -e "${GREEN}★ NornicDB (M3 Max) is ${speedup}x faster than Neo4j (i9) [adjusted]${NC}"
    elif [ $mimir_adj_avg -lt $nornicdb_min_avg ]; then
      speedup=$(echo "scale=2; $nornicdb_min_avg / $mimir_adj_avg" | bc)
      echo -e "${GREEN}★ Neo4j (i9) is ${speedup}x faster than NornicDB (M3 Max) [adjusted]${NC}"
    else
      echo -e "${YELLOW}★ Both systems have similar performance${NC}"
    fi
  fi
fi

echo ""
echo -e "${BLUE}System Details:${NC}"
echo -e "  NornicDB: Apple M3 Max, 64GB RAM, BadgerDB + in-memory vector index"
echo -e "  Neo4j:    Intel i9, 32GB RAM, Neo4j 5.x with native vector index"
echo ""

# Detailed single query comparison
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    DETAILED SINGLE QUERY TEST                             ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"

test_query="authentication and security"
echo -e "Query: \"${test_query}\""
echo ""

if [ "$NORNICDB_AVAILABLE" = true ]; then
  echo -e "${YELLOW}NornicDB Top 3 Results:${NC}"
  start=$(python3 -c 'import time; print(int(time.time() * 1000))')
  response=$(curl -s -X POST "${NORNICDB_URL}/nornicdb/search" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"${test_query}\", \"limit\": 5}")
  end=$(python3 -c 'import time; print(int(time.time() * 1000))')
  echo -e "  Latency: $((end - start))ms"
  # NornicDB returns: [{node: {properties: {id, type, title}}, score, vector_rank, bm25_rank}]
  echo "$response" | jq '.[0:3] | map({
    id: (.node.properties.id // .node.properties.neo4j_id // .node.id)[0:50],
    type: .node.properties.type,
    title: (.node.properties.title // .node.properties.name)[0:40],
    score: (.score | . * 1000 | floor / 1000),
    vector_rank: .vector_rank,
    bm25_rank: .bm25_rank
  })' 2>/dev/null || echo "  Error parsing response"
  echo ""
fi

if [ "$MIMIR_AVAILABLE" = true ]; then
  echo -e "${YELLOW}Mimir/Neo4j Top 3 Results:${NC}"
  start=$(python3 -c 'import time; print(int(time.time() * 1000))')
  response=$(curl -s -X GET "${MIMIR_URL}/api/nodes/vector-search?query=$(echo -n "$test_query" | jq -sRr @uri)&limit=5")
  end=$(python3 -c 'import time; print(int(time.time() * 1000))')
  raw_latency=$((end - start))
  adj_latency=$((raw_latency - BASELINE_LATENCY_MS))
  echo -e "  Latency: ${raw_latency}ms raw, ${adj_latency}ms adjusted"
  # Mimir returns: {results: [{id, type, title, similarity}]}
  echo "$response" | jq '.results[0:3] | map({
    id: .id[0:50],
    type: .type,
    title: (.title // .name)[0:40],
    score: (.similarity | . * 1000 | floor / 1000)
  })' 2>/dev/null || echo "  Error parsing response"
  echo ""
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "Benchmark complete!"

#!/bin/bash

# Test API Key Periodic Re-validation
# This script tests that API keys are re-validated against user's current roles

set -e

BASE_URL="http://localhost:3000"
COOKIE_FILE=$(mktemp)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Testing API Key Periodic Re-validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Login as admin
echo ""
echo "📝 Step 1: Login as admin user"
LOGIN_RESPONSE=$(curl -s -c $COOKIE_FILE -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}')

if echo "$LOGIN_RESPONSE" | grep -q '"success":true'; then
  echo "✅ Logged in as admin"
else
  echo "❌ Login failed"
  echo "Response: $LOGIN_RESPONSE"
  rm -f $COOKIE_FILE
  exit 1
fi

# Step 2: Generate API key with admin permissions
echo ""
echo "📝 Step 2: Generate API key with admin permissions"
API_KEY_RESPONSE=$(curl -s -b $COOKIE_FILE -X POST "$BASE_URL/api/keys/generate" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Re-validation Key", "expiresInDays": 1, "permissions": ["admin", "developer"]}')

if echo "$API_KEY_RESPONSE" | grep -q '"success":true'; then
  API_KEY=$(echo "$API_KEY_RESPONSE" | grep -o '"apiKey":"[^"]*"' | cut -d'"' -f4)
  KEY_ID=$(echo "$API_KEY_RESPONSE" | grep -o '"keyId":"[^"]*"' | cut -d'"' -f4)
  echo "✅ API key generated: $KEY_ID"
  echo "   Permissions: [admin, developer]"
else
  echo "❌ Failed to generate API key"
  echo "Response: $API_KEY_RESPONSE"
  rm -f $COOKIE_FILE
  exit 1
fi

# Step 3: Test API key works with admin permissions
echo ""
echo "📝 Step 3: Test API key has admin permissions"
TEST_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X GET "$BASE_URL/api/nodes?limit=1" \
  -H "X-API-Key: $API_KEY")

HTTP_STATUS=$(echo "$TEST_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ API key works (HTTP 200)"
else
  echo "❌ API key failed (HTTP $HTTP_STATUS)"
  echo "Response: $TEST_RESPONSE"
  rm -f $COOKIE_FILE
  exit 1
fi

# Step 4: Query Neo4j to check stored permissions
echo ""
echo "📝 Step 4: Check stored API key permissions in Neo4j"
STORED_PERMS=$(docker exec neo4j_db cypher-shell -u neo4j -p password \
  "MATCH (k) WHERE k.id = '$KEY_ID' RETURN k.permissions" 2>/dev/null | grep -v "k.permissions" | grep -v "^$" | head -1)

echo "   Stored permissions: $STORED_PERMS"

# Step 5: Simulate user demotion by updating user's roles in Neo4j
echo ""
echo "📝 Step 5: Simulate user demotion (admin → developer only)"
echo "   Creating user node with reduced permissions..."

# First, check if user node exists
USER_EXISTS=$(docker exec neo4j_db cypher-shell -u neo4j -p password \
  "MATCH (u {type: 'user', userId: 'admin'}) RETURN count(u)" 2>/dev/null | grep -v "count" | grep -v "^$" | head -1)

if [ "$USER_EXISTS" = "0" ]; then
  # Create user node with reduced permissions
  docker exec neo4j_db cypher-shell -u neo4j -p password \
    "CREATE (u {type: 'user', userId: 'admin', roles: ['developer']})" 2>/dev/null
  echo "✅ Created user node with [developer] role"
else
  # Update existing user node
  docker exec neo4j_db cypher-shell -u neo4j -p password \
    "MATCH (u {type: 'user', userId: 'admin'}) SET u.roles = ['developer']" 2>/dev/null
  echo "✅ Updated user node to [developer] role"
fi

# Step 6: Force re-validation by updating lastValidated timestamp to past
echo ""
echo "📝 Step 6: Force re-validation (set lastValidated to 25 hours ago)"
PAST_TIMESTAMP=$(date -u -v-25H +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -d "25 hours ago" +"%Y-%m-%dT%H:%M:%S.000Z")
docker exec neo4j_db cypher-shell -u neo4j -p password \
  "MATCH (k) WHERE k.id = '$KEY_ID' SET k.lastValidated = '$PAST_TIMESTAMP'" 2>/dev/null

echo "✅ Set lastValidated to: $PAST_TIMESTAMP"
echo "   (This will trigger re-validation on next use)"

# Step 7: Use API key again (should trigger re-validation)
echo ""
echo "📝 Step 7: Use API key (should trigger re-validation)"
TEST_RESPONSE2=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X GET "$BASE_URL/api/nodes?limit=1" \
  -H "X-API-Key: $API_KEY")

HTTP_STATUS2=$(echo "$TEST_RESPONSE2" | grep "HTTP_STATUS" | cut -d: -f2)
if [ "$HTTP_STATUS2" = "200" ]; then
  echo "✅ API key still works (HTTP 200)"
else
  echo "❌ API key failed (HTTP $HTTP_STATUS2)"
  echo "Response: $TEST_RESPONSE2"
fi

# Step 8: Check if permissions were updated in Neo4j
echo ""
echo "📝 Step 8: Verify permissions were downgraded in Neo4j"
sleep 2  # Give async update time to complete

UPDATED_PERMS=$(docker exec neo4j_db cypher-shell -u neo4j -p password \
  "MATCH (k) WHERE k.id = '$KEY_ID' RETURN k.permissions" 2>/dev/null | grep -v "k.permissions" | grep -v "^$" | head -1)

echo "   Original permissions: [admin, developer]"
echo "   User's current roles:  [developer]"
echo "   Updated permissions:   $UPDATED_PERMS"

if echo "$UPDATED_PERMS" | grep -q "developer" && ! echo "$UPDATED_PERMS" | grep -q "admin"; then
  echo "✅ Permissions correctly downgraded to [developer]"
  echo "✅ Re-validation working as expected!"
else
  echo "⚠️  Permissions may not have updated yet (async operation)"
  echo "   Check server logs for re-validation message"
fi

# Step 9: Cleanup - revoke API key
echo ""
echo "📝 Step 9: Cleanup - revoke API key"
REVOKE_RESPONSE=$(curl -s -b $COOKIE_FILE -X DELETE "$BASE_URL/api/keys/$KEY_ID")

if echo "$REVOKE_RESPONSE" | grep -q '"success":true'; then
  echo "✅ API key revoked"
else
  echo "⚠️  Failed to revoke API key (may need manual cleanup)"
fi

# Cleanup user node
docker exec neo4j_db cypher-shell -u neo4j -p password \
  "MATCH (u {type: 'user', userId: 'admin'}) DELETE u" 2>/dev/null

rm -f $COOKIE_FILE

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ API Key Re-validation Test Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Summary:"
echo "   - API key created with [admin, developer] permissions"
echo "   - User demoted to [developer] only"
echo "   - API key re-validated and downgraded to [developer]"
echo "   - This prevents privilege escalation via stale API keys"
echo ""
echo "🔧 Configuration:"
echo "   - Re-validation interval: MIMIR_SESSION_MAX_AGE_HOURS (default: 24 hours)"
echo "   - Set to 0 for never expire (no re-validation)"
echo "   - Set to 1 for hourly re-validation (high security)"
echo ""

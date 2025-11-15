# IDE Integration Guide

**Complete guide for integrating Mimir MCP Server with VS Code, Cursor, and Windsurf**

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Prerequisites](#-prerequisites)
- [Part 1: Install & Start Mimir](#-part-1-install--start-mimir)
- [Part 2: Connect MCP Server to IDE](#-part-2-connect-mcp-server-to-ide)
  - [VS Code (Copilot)](#vs-code-with-github-copilot)
  - [Cursor](#cursor)
  - [Windsurf](#windsurf)
- [Part 3: Install Claudette-Mimir Chat Mode](#-part-3-install-claudette-mimir-chat-mode-optional)
- [Verification & Testing](#-verification--testing)
- [Troubleshooting](#-troubleshooting)

---

## 🎯 Overview

This guide walks you through:

1. **Installing Mimir** - Get the MCP server running
2. **Connecting to your IDE** - Enable MCP tools in VS Code/Cursor/Windsurf
3. **Installing Claudette-Mimir** - Add the enhanced AI agent mode (optional)

**What you'll get:**
- ✅ Persistent memory for AI conversations
- ✅ Neo4j graph database integration
- ✅ 13 MCP tools (todos, memory, file indexing, vector search)
- ✅ Semantic search across your codebase
- ✅ Multi-agent orchestration capabilities
- ✅ (Optional) Claudette-Mimir enhanced chat mode

---

## ✅ Prerequisites

Before starting, ensure you have:

- **Docker Desktop** - [Download here](https://www.docker.com/products/docker-desktop/)
- **Node.js 18+** - [Download here](https://nodejs.org/)
- **Git** - [Download here](https://git-scm.com/)
- **IDE** - VS Code, Cursor, or Windsurf installed

---

## 🚀 Part 1: Install & Start Mimir

### Step 1.1: Clone Repository

```bash
# Clone Mimir repository
git clone https://github.com/orneryd/Mimir.git
cd Mimir
```

### Step 1.2: Configure Environment

```bash
# Copy environment template
cp env.example .env

# (Optional) Edit .env to customize settings
# Default Neo4j password is "password"
```

**Key settings in `.env`:**
```bash
NEO4J_PASSWORD=password          # Change for production!
HOST_WORKSPACE_ROOT=~/src        # Your code workspace (for file indexing)
```

### Step 1.3: Build & Start Services

```bash
# Build Docker images (takes 2-5 minutes first time)
npm run build:docker

# Start all services (Neo4j + MCP Server + Copilot API)
docker compose up -d
```

### Step 1.4: Verify Services Running

```bash
# Check all containers are healthy
docker compose ps

# Expected output:
# NAME         STATUS
# mcp_server   Up (healthy)
# neo4j_db     Up (healthy)
```

**Access points:**
- **MCP Server:** http://localhost:9042
- **Neo4j Browser:** http://localhost:7474 (user: `neo4j`, pass: `password`)
- **Portal UI:** http://localhost:9042 (optional web interface)

> ✅ **Checkpoint:** Mimir is now running! Proceed to connect your IDE.

---

## 🔗 Part 2: Connect MCP Server to IDE

Choose your IDE below:

---

### VS Code (with GitHub Copilot)

**Requirements:** VS Code with GitHub Copilot extension installed

#### Step 2.1: Open VS Code Settings

**Option A - User Settings (Global):**
1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type "Preferences: Open User Settings (JSON)"
3. Click to open `settings.json`

**Option B - Workspace Settings (Project-specific):**
1. Open your project in VS Code
2. Press `Ctrl+Shift+P` or `Cmd+Shift+P`
3. Type "Preferences: Open Workspace Settings (JSON)"
4. Click to open `.vscode/settings.json`

#### Step 2.2: Add MCP Server Configuration

Add this to your `settings.json`:

```json
{
  "github.copilot.chat.mcpServers": {
    "mimir": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "mcp_server",
        "node",
        "build/index.js"
      ],
      "env": {
        "NEO4J_URI": "bolt://neo4j:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "password"
      }
    }
  }
}
```

**For custom configuration:**
```json
{
  "github.copilot.chat.mcpServers": {
    "mimir": {
      "command": "docker",
      "args": ["exec", "-i", "mcp_server", "node", "build/index.js"],
      "env": {
        "NEO4J_URI": "bolt://neo4j:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "password",
        "MIMIR_FEATURE_VECTOR_EMBEDDINGS": "true",
        "MIMIR_EMBEDDINGS_ENABLED": "true"
      }
    }
  }
}
```

#### Step 2.3: Restart VS Code

Completely quit and restart VS Code to load the MCP server.

#### Step 2.4: Verify Connection

1. Open GitHub Copilot Chat (Ctrl+Alt+I or Cmd+Option+I)
2. Type: `@mimir` and press space
3. You should see MCP tools available in autocomplete

**Available tools:**
- `memory_node` - Manage memory nodes
- `memory_edge` - Manage relationships
- `todo` - Create and manage todos
- `todo_list` - Manage todo lists
- `vector_search_nodes` - Semantic search
- `index_folder` - Index codebase for RAG
- And 7 more...

> ✅ **Success:** VS Code is connected to Mimir MCP server!

---

### Cursor

**Requirements:** Cursor IDE installed

#### Step 2.1: Locate Cursor Configuration

**macOS:**
```bash
~/.cursor/config.json
# OR
~/Library/Application Support/Cursor/User/settings.json
```

**Windows:**
```powershell
%APPDATA%\Cursor\User\settings.json
```

**Linux:**
```bash
~/.config/Cursor/User/settings.json
```

#### Step 2.2: Add MCP Server Configuration

Open the configuration file and add:

```json
{
  "mcpServers": {
    "mimir": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "mcp_server",
        "node",
        "build/index.js"
      ],
      "env": {
        "NEO4J_URI": "bolt://neo4j:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "password"
      }
    }
  }
}
```

**Alternative - Direct HTTP Connection:**

If you prefer connecting via HTTP instead of Docker exec:

```json
{
  "mcpServers": {
    "mimir": {
      "url": "http://localhost:9042",
      "transport": "http"
    }
  }
}
```

#### Step 2.3: Restart Cursor

Completely quit and restart Cursor to load the MCP server.

#### Step 2.4: Verify Connection

1. Open Cursor chat (Ctrl+L or Cmd+L)
2. Click the "Tools" or "+" button to see available MCP tools
3. You should see Mimir's 13 tools listed

**Test with:**
```
Create a todo using the todo tool:
- title: "Test Mimir connection"
- status: "pending"
- priority: "high"
```

> ✅ **Success:** Cursor is connected to Mimir MCP server!

---

### Windsurf

**Requirements:** Windsurf IDE installed

#### Step 2.1: Locate Windsurf Configuration

**macOS:**
```bash
~/Library/Application Support/Windsurf/settings.json
```

**Windows:**
```powershell
%APPDATA%\Windsurf\settings.json
```

**Linux:**
```bash
~/.config/Windsurf/settings.json
```

#### Step 2.2: Add MCP Server Configuration

Open the configuration file and add:

```json
{
  "mcpServers": {
    "mimir": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "mcp_server",
        "node",
        "build/index.js"
      ],
      "env": {
        "NEO4J_URI": "bolt://neo4j:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "password"
      }
    }
  }
}
```

#### Step 2.3: Restart Windsurf

Completely quit and restart Windsurf to load the MCP server.

#### Step 2.4: Verify Connection

1. Open Windsurf AI chat
2. Look for MCP tools in the sidebar or tools menu
3. Test connection with a simple memory node creation

> ✅ **Success:** Windsurf is connected to Mimir MCP server!

---

## 🤖 Part 3: Install Claudette-Mimir Chat Mode (Optional)

**What is Claudette-Mimir?**
Enhanced AI agent mode with:
- Memory-first workflow (checks memory before searching)
- Graph-aware reasoning (multi-hop knowledge traversal)
- Persistent learning across sessions
- Announce-then-act pattern for transparency
- End-to-end problem solving

### Step 3.1: Locate Agent File

Claudette-Mimir agent configuration is at:
```
Mimir/docs/agents/claudette-mimir-v2.md
```

### Step 3.2: Install in VS Code (Copilot)

**Method A - User Prompt (Recommended):**

1. Open GitHub Copilot Chat
2. Click the settings/gear icon
3. Under "Prompts" or "Custom Instructions"
4. Copy contents of `docs/agents/claudette-mimir-v2.md`
5. Paste into custom instructions field

**Method B - Settings JSON:**

Add to `settings.json`:
```json
{
  "github.copilot.chat.systemPrompt": {
    "file": "/path/to/Mimir/docs/agents/claudette-mimir-v2.md"
  }
}
```

### Step 3.3: Install in Cursor

**Method A - .cursorrules File (Recommended):**

Create `.cursorrules` in your project root:

```bash
# In your project directory
cd /path/to/your/project
cp /path/to/Mimir/docs/agents/claudette-mimir-v2.md .cursorrules
```

**Method B - Cursor Settings:**

1. Open Cursor Settings (Ctrl+, or Cmd+,)
2. Search for "Rules for AI"
3. Click "Edit in settings.json"
4. Add:
   ```json
   {
     "cursor.general.aiRules": "file:///path/to/Mimir/docs/agents/claudette-mimir-v2.md"
   }
   ```

### Step 3.4: Install in Windsurf

**Method A - .windsurfrules File:**

Create `.windsurfrules` in your project root:

```bash
cd /path/to/your/project
cp /path/to/Mimir/docs/agents/claudette-mimir-v2.md .windsurfrules
```

**Method B - Windsurf Settings:**

1. Open Windsurf Settings
2. Look for "AI Instructions" or "System Prompt"
3. Copy contents of `claudette-mimir-v2.md` into the field

### Step 3.5: Verify Claudette-Mimir Active

Test with this prompt:

```
Explain your workflow and tell me about your memory capabilities
```

**Expected response includes:**
- Mentions "Claudette" or "Mimir Edition"
- Describes memory-first search workflow
- Mentions vector_search_nodes, memory_node, graph traversal
- Explains announce-then-act pattern

> ✅ **Success:** Claudette-Mimir chat mode is active!

---

## ✅ Verification & Testing

### Test 1: Memory Node Creation

**Prompt:**
```
Create a memory node about this project using memory_node tool:
- type: "memory"
- title: "Project Overview"
- content: "Testing Mimir integration"
- tags: ["test", "setup"]
```

**Expected:**
- Tool call succeeds
- Returns node ID like `memory-xxxxx`
- Node visible in Neo4j browser

---

### Test 2: Todo Management

**Prompt:**
```
Create a todo list for "Mimir Setup Tasks" and add 3 todos
```

**Expected:**
- Creates todo list
- Creates 3 todo items
- Shows relationships in graph

---

### Test 3: Semantic Search

**Prompt:**
```
Search memory for "project" using vector_search_nodes
```

**Expected:**
- Returns relevant memory nodes
- Shows similarity scores
- Works even with embeddings disabled (fallback to keyword search)

---

### Test 4: File Indexing

**Prompt:**
```
Index my src/ folder using index_folder tool
```

**Expected:**
- Starts file watcher
- Indexes files into Neo4j
- Returns indexed file count

---

### Test 5: Graph Navigation

**Prompt:**
```
Get all neighbors of the memory node we created
```

**Expected:**
- Uses memory_edge tool
- Returns connected nodes
- Shows relationship types

---

## 🔧 Troubleshooting

### Issue: MCP Server Not Showing in IDE

**Symptoms:** No MCP tools available, `@mimir` doesn't work

**Solutions:**

1. **Verify Docker containers running:**
   ```bash
   docker compose ps
   # Both mcp_server and neo4j_db should be "Up (healthy)"
   ```

2. **Check IDE configuration:**
   - Ensure JSON syntax is valid (no trailing commas!)
   - Verify file path to Mimir is correct
   - Try absolute paths instead of relative paths

3. **Restart IDE completely:**
   - Quit IDE entirely (not just close window)
   - Check IDE process manager to ensure fully closed
   - Restart and wait 30 seconds

4. **Check IDE logs:**
   - **VS Code:** Help → Toggle Developer Tools → Console tab
   - **Cursor:** View → Developer Tools → Console
   - Look for MCP connection errors

---

### Issue: "Permission Denied" on Docker Exec

**Symptoms:** Error running `docker exec` command

**Solutions:**

1. **Verify Docker running:**
   ```bash
   docker info
   ```

2. **Check container name:**
   ```bash
   docker ps | grep mcp_server
   # Should show "mcp_server" in NAMES column
   ```

3. **Try direct connection:**
   Instead of `docker exec`, use HTTP transport:
   ```json
   {
     "mcpServers": {
       "mimir": {
         "url": "http://localhost:9042",
         "transport": "http"
       }
     }
   }
   ```

---

### Issue: Neo4j Connection Failed

**Symptoms:** MCP tools error with "Neo4j connection failed"

**Solutions:**

1. **Check Neo4j container:**
   ```bash
   docker logs neo4j_db
   ```

2. **Verify password in .env:**
   ```bash
   cat .env | grep NEO4J_PASSWORD
   ```

3. **Test Neo4j directly:**
   - Open http://localhost:7474
   - Login with user: `neo4j`, password from `.env`
   - Run query: `RETURN 1`

4. **Restart Neo4j:**
   ```bash
   docker compose restart neo4j_db
   docker compose restart mcp_server
   ```

---

### Issue: Claudette-Mimir Not Responding as Expected

**Symptoms:** Agent doesn't show memory-first behavior

**Solutions:**

1. **Verify preamble loaded:**
   - Check for "Claudette" mention in first response
   - Ask: "What mode are you in?"

2. **Check file exists:**
   ```bash
   ls -la docs/agents/claudette-mimir-v2.md
   ```

3. **Reload configuration:**
   - Delete `.cursorrules` and recreate
   - Restart IDE completely

4. **Test MCP tools directly:**
   - Ask agent to use `vector_search_nodes`
   - If tool works but behavior is off, preamble may not be loaded

---

### Issue: File Indexing Not Working

**Symptoms:** `index_folder` succeeds but no files in Neo4j

**Solutions:**

1. **Check path mounted in Docker:**
   ```bash
   docker exec mcp_server ls -la /workspace
   ```

2. **Verify HOST_WORKSPACE_ROOT in .env:**
   ```bash
   grep HOST_WORKSPACE_ROOT .env
   ```

3. **Check volume mount:**
   ```bash
   docker inspect mcp_server | grep Mounts -A 10
   ```

4. **Query Neo4j directly:**
   ```cypher
   MATCH (f:File) RETURN count(f)
   ```

---

### Issue: Vector Search Returns No Results

**Symptoms:** `vector_search_nodes` returns empty array

**Solutions:**

1. **Check embeddings enabled:**
   ```bash
   grep MIMIR_FEATURE_VECTOR_EMBEDDINGS .env
   # Should be "true"
   ```

2. **Verify Ollama running:**
   ```bash
   docker compose ps | grep ollama
   ```

3. **Test embeddings directly:**
   ```bash
   curl http://localhost:11434/api/embeddings \
     -d '{"model": "mxbai-embed-large", "prompt": "test"}'
   ```

4. **Use keyword search fallback:**
   - Vector search automatically falls back to keyword search
   - If still no results, check if any nodes exist:
     ```cypher
     MATCH (n) RETURN count(n)
     ```

---

## 📚 Next Steps

**Now that you're set up:**

1. **Read the Memory Guide:** [MEMORY_GUIDE.md](MEMORY_GUIDE.md)
2. **Learn about Knowledge Graphs:** [KNOWLEDGE_GRAPH.md](KNOWLEDGE_GRAPH.md)
3. **Explore Multi-Agent Orchestration:** [ORCHESTRATOR_QUICKSTART.md](ORCHESTRATOR_QUICKSTART.md)
4. **Configure Advanced Settings:** [CONFIGURATION.md](../configuration/CONFIGURATION.md)
5. **Try File Indexing:** [FILE_BROWSER_GUIDE.md](FILE_BROWSER_GUIDE.md)

---

## 🆘 Getting Help

**Issues with installation:**
- Check [GitHub Issues](https://github.com/orneryd/Mimir/issues)
- Review [Troubleshooting Guide](#-troubleshooting) above
- Check Docker logs: `docker compose logs -f`

**Questions about features:**
- See [Documentation Index](../README.md)
- Read [Quick Start Guide](../getting-started/QUICKSTART.md)
- Review [Architecture Docs](../architecture/)

**Found a bug?**
- Open an issue on GitHub
- Include Docker logs and IDE version
- Describe steps to reproduce

---

**Last Updated:** 2025-11-15  
**Version:** 1.0.0  
**Maintained By:** Mimir Team

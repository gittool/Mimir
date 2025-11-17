/**
 * MCP Server Tools for LangChain Agents
 * 
 * Provides access to MCP server at http://localhost:3000/mcp
 * Exposes Mimir's 6 consolidated tools directly (memory_node, memory_edge, memory_batch, memory_lock, todo, todo_list)
 * instead of 20+ granular tools to reduce API calls and improve efficiency.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000/mcp';

/**
 * Call MCP server tool
 */
async function callMCPTool(toolName: string, args: Record<string, any>): Promise<string> {
  try {
    const response = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });

    if (!response.ok) {
      return `MCP server error: ${response.status} ${response.statusText}`;
    }

    const result = await response.json();
    
    if (result.error) {
      return `MCP error: ${result.error.message || JSON.stringify(result.error)}`;
    }

    // Return the content from the tool call result
    if (result.result?.content?.[0]?.text) {
      return result.result.content[0].text;
    }

    return JSON.stringify(result.result, null, 2);
  } catch (error: any) {
    return `Error calling MCP server: ${error.message}`;
  }
}

/**
 * Consolidated MCP Tools - Direct pass-through to Mimir's unified API
 */

// ============================================================================
// MEMORY_NODE - Unified node operations (add, get, update, delete, query, search)
// ============================================================================

export const memoryNodeTool = new DynamicStructuredTool({
  name: 'memory_node',
  description: `Manage knowledge graph nodes. Operations: add, get, update, delete, query, search.

Examples:
- Add: { operation: "add", type: "memory", properties: { title: "...", content: "..." } }
- Get: { operation: "get", id: "node-123" }
- Update: { operation: "update", id: "node-123", properties: { status: "completed" } }
- Delete: { operation: "delete", id: "node-123" }
- Query: { operation: "query", type: "todo", filters: { status: "pending" } }
- Search: { operation: "search", query: "authentication", options: { types: ["memory"], limit: 10 } }`,
  schema: z.object({
    operation: z.enum(['add', 'get', 'update', 'delete', 'query', 'search']).describe('Operation to perform'),
    type: z.string().optional().describe('Node type (for add/query): memory, todo, concept, file, etc.'),
    id: z.string().optional().describe('Node ID (for get/update/delete)'),
    properties: z.record(z.string(), z.any()).optional().describe('Node properties (for add/update)'),
    filters: z.record(z.string(), z.any()).optional().describe('Property filters (for query)'),
    query: z.string().optional().describe('Search query text (for search)'),
    options: z.record(z.string(), z.any()).optional().describe('Search options: { types: [...], limit: 10 }'),
  }),
  func: async (args) => {
    return await callMCPTool('memory_node', args);
  },
});

// ============================================================================
// MEMORY_EDGE - Unified edge/relationship operations (add, delete, get, neighbors, subgraph)
// ============================================================================

export const memoryEdgeTool = new DynamicStructuredTool({
  name: 'memory_edge',
  description: `Manage relationships between nodes. Operations: add, delete, get, neighbors, subgraph.

Examples:
- Add edge: { operation: "add", source: "node-1", target: "node-2", type: "depends_on", properties: {} }
- Delete edge: { operation: "delete", edge_id: "edge-123" }
- Get edges: { operation: "get", node_id: "node-1", direction: "both" }
- Get neighbors: { operation: "neighbors", node_id: "node-1", depth: 1, edge_type: "depends_on" }
- Get subgraph: { operation: "subgraph", node_id: "node-1", depth: 2 }`,
  schema: z.object({
    operation: z.enum(['add', 'delete', 'get', 'neighbors', 'subgraph']).describe('Operation to perform'),
    source: z.string().optional().describe('Source node ID (for add)'),
    target: z.string().optional().describe('Target node ID (for add)'),
    type: z.string().optional().describe('Edge type: depends_on, implements, contains, relates_to (for add)'),
    properties: z.record(z.string(), z.any()).optional().describe('Edge properties (for add)'),
    edge_id: z.string().optional().describe('Edge ID (for delete)'),
    node_id: z.string().optional().describe('Node ID (for get/neighbors/subgraph)'),
    direction: z.enum(['in', 'out', 'both']).optional().describe('Edge direction (for get)'),
    depth: z.number().optional().describe('Traversal depth (for neighbors/subgraph)'),
    edge_type: z.string().optional().describe('Filter by edge type (for neighbors)'),
  }),
  func: async (args) => {
    return await callMCPTool('memory_edge', args);
  },
});

// ============================================================================
// MEMORY_BATCH - Bulk operations (add_nodes, update_nodes, delete_nodes, add_edges, delete_edges)
// ============================================================================

export const memoryBatchTool = new DynamicStructuredTool({
  name: 'memory_batch',
  description: `Perform bulk operations efficiently. Operations: add_nodes, update_nodes, delete_nodes, add_edges, delete_edges.

Examples:
- Add nodes: { operation: "add_nodes", nodes: [{ type: "todo", properties: {...} }, ...] }
- Update nodes: { operation: "update_nodes", updates: [{ id: "node-1", properties: {...} }, ...] }
- Delete nodes: { operation: "delete_nodes", ids: ["node-1", "node-2"] }
- Add edges: { operation: "add_edges", edges: [{ source: "a", target: "b", type: "depends_on" }, ...] }
- Delete edges: { operation: "delete_edges", ids: ["edge-1", "edge-2"] }`,
  schema: z.object({
    operation: z.enum(['add_nodes', 'update_nodes', 'delete_nodes', 'add_edges', 'delete_edges']).describe('Batch operation'),
    nodes: z.array(z.object({
      type: z.string(),
      properties: z.record(z.string(), z.any()),
    })).optional().describe('Nodes to create (for add_nodes)'),
    updates: z.array(z.object({
      id: z.string(),
      properties: z.record(z.string(), z.any()),
    })).optional().describe('Node updates (for update_nodes)'),
    ids: z.array(z.string()).optional().describe('IDs to delete (for delete_nodes/delete_edges)'),
    edges: z.array(z.object({
      source: z.string(),
      target: z.string(),
      type: z.string(),
      properties: z.record(z.string(), z.any()).optional(),
    })).optional().describe('Edges to create (for add_edges)'),
  }),
  func: async (args) => {
    return await callMCPTool('memory_batch', args);
  },
});

// ============================================================================
// MEMORY_LOCK - Multi-agent coordination (acquire, release, query_available, cleanup)
// ============================================================================

export const memoryLockTool = new DynamicStructuredTool({
  name: 'memory_lock',
  description: `Manage locks for multi-agent coordination. Operations: acquire, release, query_available, cleanup.

Examples:
- Acquire: { operation: "acquire", node_id: "todo-1", agent_id: "worker-1", timeout_ms: 300000 }
- Release: { operation: "release", node_id: "todo-1", agent_id: "worker-1" }
- Query available: { operation: "query_available", type: "todo", filters: { status: "pending" } }
- Cleanup stale locks: { operation: "cleanup" }`,
  schema: z.object({
    operation: z.enum(['acquire', 'release', 'query_available', 'cleanup']).describe('Lock operation'),
    node_id: z.string().optional().describe('Node ID (for acquire/release)'),
    agent_id: z.string().optional().describe('Agent ID (for acquire/release)'),
    timeout_ms: z.number().optional().describe('Lock timeout in ms (default: 300000)'),
    type: z.string().optional().describe('Node type filter (for query_available)'),
    filters: z.record(z.string(), z.any()).optional().describe('Property filters (for query_available)'),
  }),
  func: async (args) => {
    return await callMCPTool('memory_lock', args);
  },
});

// ============================================================================
// TODO - Todo item management (create, get, update, complete, delete, list)
// ============================================================================

export const todoTool = new DynamicStructuredTool({
  name: 'todo',
  description: `Manage individual TODO items. Operations: create, get, update, complete, delete, list.

Examples:
- Create: { operation: "create", title: "Fix bug", description: "...", priority: "high", status: "pending" }
- Get: { operation: "get", todo_id: "todo-123" }
- Update: { operation: "update", todo_id: "todo-123", status: "in_progress", priority: "high" }
- Complete: { operation: "complete", todo_id: "todo-123" }
- Delete: { operation: "delete", todo_id: "todo-123" }
- List: { operation: "list", filters: { status: "pending", priority: "high" } }`,
  schema: z.object({
    operation: z.enum(['create', 'get', 'update', 'complete', 'delete', 'list']).describe('Todo operation'),
    todo_id: z.string().optional().describe('Todo ID (for get/update/complete/delete)'),
    title: z.string().optional().describe('Todo title (for create)'),
    description: z.string().optional().describe('Description (for create/update)'),
    priority: z.enum(['low', 'medium', 'high']).optional().describe('Priority level'),
    status: z.enum(['pending', 'in_progress', 'completed']).optional().describe('Status'),
    properties: z.record(z.string(), z.any()).optional().describe('Additional properties'),
    list_id: z.string().optional().describe('List ID to add todo to'),
    filters: z.record(z.string(), z.any()).optional().describe('Filters for list operation'),
  }),
  func: async (args) => {
    return await callMCPTool('todo', args);
  },
});

// ============================================================================
// TODO_LIST - Todo list management (create, get, update, archive, delete, list, add_todo, remove_todo, get_stats)
// ============================================================================

export const todoListTool = new DynamicStructuredTool({
  name: 'todo_list',
  description: `Manage TODO lists (collections of todos). Operations: create, get, update, archive, delete, list, add_todo, remove_todo, get_stats.

Examples:
- Create: { operation: "create", title: "Sprint 1", description: "...", priority: "high" }
- Get: { operation: "get", list_id: "list-123" }
- Update: { operation: "update", list_id: "list-123", properties: { title: "Sprint 2" } }
- Archive: { operation: "archive", list_id: "list-123", remove_completed: true }
- Add todo: { operation: "add_todo", list_id: "list-123", todo_id: "todo-456" }
- Remove todo: { operation: "remove_todo", list_id: "list-123", todo_id: "todo-456" }
- Get stats: { operation: "get_stats", list_id: "list-123" }
- List: { operation: "list", filters: { archived: false } }`,
  schema: z.object({
    operation: z.enum(['create', 'get', 'update', 'archive', 'delete', 'list', 'add_todo', 'remove_todo', 'get_stats']).describe('List operation'),
    list_id: z.string().optional().describe('List ID (for get/update/archive/delete/add_todo/remove_todo/get_stats)'),
    title: z.string().optional().describe('List title (for create)'),
    description: z.string().optional().describe('Description (for create/update)'),
    priority: z.enum(['low', 'medium', 'high']).optional().describe('Priority level'),
    properties: z.record(z.string(), z.any()).optional().describe('Additional properties'),
    remove_completed: z.boolean().optional().describe('Delete completed todos when archiving (default: false)'),
    todo_id: z.string().optional().describe('Todo ID (for add_todo/remove_todo)'),
    filters: z.record(z.string(), z.any()).optional().describe('Filters for list operation'),
  }),
  func: async (args) => {
    return await callMCPTool('todo_list', args);
  },
});

/**
 * All MCP tools exported - 6 consolidated tools for direct pass-through to Mimir's unified API
 */
export const mcpTools = [
  memoryNodeTool,    // All node operations: add, get, update, delete, query, search
  memoryEdgeTool,    // All edge operations: add, delete, get, neighbors, subgraph
  memoryBatchTool,   // Bulk operations: add_nodes, update_nodes, delete_nodes, add_edges, delete_edges
  memoryLockTool,    // Multi-agent coordination: acquire, release, query_available, cleanup
  todoTool,          // Todo management: create, get, update, complete, delete, list
  todoListTool,      // Todo list management: create, get, update, archive, add_todo, remove_todo, get_stats
];

/**
 * Consolidated tools (same as mcpTools - kept for compatibility)
 */
export const consolidatedMCPTools = mcpTools;

/**
 * Get MCP tool names for logging
 */
export function getMCPToolNames(): string[] {
  return mcpTools.map(tool => tool.name);
}


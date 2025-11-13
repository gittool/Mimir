import { Router, Request, Response } from 'express';
import type { IGraphManager } from '../types/index.js';
import { CopilotAgentClient } from '../orchestrator/llm-client.js';
import { CopilotModel } from '../orchestrator/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import neo4j from 'neo4j-driver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate agent preamble using Agentinator
 */
async function generatePreambleWithAgentinator(
  roleDescription: string,
  agentType: 'worker' | 'qc'
): Promise<{ name: string; role: string; content: string }> {
  try {
    // Load Agentinator preamble
    const agentinatorPath = path.join(__dirname, '../../docs/agents/v2/02-agentinator-preamble.md');
    const agentinatorPreamble = await fs.readFile(agentinatorPath, 'utf-8');

    // Load appropriate template
    const templatePath = path.join(
      __dirname,
      '../../docs/agents/v2/templates',
      agentType === 'worker' ? 'worker-template.md' : 'qc-template.md'
    );
    const template = await fs.readFile(templatePath, 'utf-8');

    // Build Agentinator prompt
    const agentinatorPrompt = `${agentinatorPreamble}

---

## INPUT

<agent_type>
${agentType}
</agent_type>

<role_description>
${roleDescription}
</role_description>

<template_path>
${agentType === 'worker' ? 'templates/worker-template.md' : 'templates/qc-template.md'}
</template_path>

---

<template_content>
${template}
</template_content>

---

Generate the complete ${agentType} preamble now. Output the preamble directly as markdown (no code fences, no explanations).`;

    // Call LLM with Agentinator preamble
    const response = await fetch('http://localhost:4141/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-copilot-dummy',
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'user',
            content: agentinatorPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 16000, // Large enough for full preambles
      }),
    });

    if (!response.ok) {
      throw new Error(`Agentinator API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const preambleContent = data.choices[0]?.message?.content || '';

    if (!preambleContent) {
      throw new Error('Agentinator returned empty preamble');
    }

    // Extract name from role description (first 3-5 words)
    const words = roleDescription.trim().split(/\s+/);
    const name = words.slice(0, Math.min(5, words.length)).join(' ');

    console.log(`✅ Agentinator generated ${preambleContent.length} character preamble for: ${name}`);

    return {
      name,
      role: roleDescription,
      content: preambleContent,
    };
  } catch (error) {
    console.error('Agentinator generation failed:', error);
    throw new Error(`Failed to generate preamble with Agentinator: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function createOrchestrationRouter(graphManager: IGraphManager): Router {
  const router = Router();

  /**
   * GET /api/agents
   * List agent preambles with semantic search and pagination
   */
  router.get('/agents', async (req: Request, res: Response) => {
    try {
      const { search, limit = 20, offset = 0, type = 'all' } = req.query;
      
      let agents: any[];
      
      if (search && typeof search === 'string') {
        // Text-based search (case-insensitive)
        const driver = graphManager.getDriver();
        const session = driver.session();
        
        try {
          const searchLower = search.toLowerCase();
          const limitInt = neo4j.int(Number(limit));
          const offsetInt = neo4j.int(Number(offset));
          
          const result = await session.run(`
            MATCH (n:Node)
            WHERE n.type = 'preamble' 
              AND ($type = 'all' OR n.agentType = $type)
              AND (
                toLower(n.name) CONTAINS $search 
                OR toLower(n.role) CONTAINS $search
                OR toLower(n.content) CONTAINS $search
              )
            RETURN n as node
            ORDER BY n.created DESC
            SKIP $offset
            LIMIT $limit
          `, {
            search: searchLower,
            limit: limitInt,
            offset: offsetInt,
            type
          });
          
          agents = result.records.map((record: any) => {
            const props = record.get('node').properties;
            // Handle both old format (Neo4j label) and new format (Node properties)
            const agentType = props.agentType || props.agent_type || 'worker';
            const roleDesc = props.roleDescription || props.role_description || props.role || '';
            const name = props.name || roleDesc.split(' ').slice(0, 4).join(' ') || 'Unnamed Agent';
            
            return {
              id: props.id,
              name,
              role: roleDesc,
              agentType,
              content: props.content || '',
              version: props.version || '1.0',
              created: props.created || props.created_at,
              // Metadata fields
              roleDescription: roleDesc,
              roleHash: props.roleHash || props.role_hash,
              charCount: props.charCount || props.char_count,
              usedCount: props.usedCount || props.used_count,
              lastUsed: props.lastUsed || props.last_used,
              generatedBy: props.generatedBy || props.generated_by
            };
          });
        } finally {
          await session.close();
        }
      } else {
        // Standard query without search
        const allAgents = await graphManager.queryNodes('preamble', 
          type !== 'all' ? { agentType: type } : undefined
        );
        
        const start = parseInt(offset as string);
        const end = start + parseInt(limit as string);
        agents = allAgents
          .slice(start, end)
          .map(node => {
            // Handle both old format and new format
            const agentType = node.properties?.agentType || node.properties?.agent_type || 'worker';
            const roleDesc = node.properties?.roleDescription || node.properties?.role_description || node.properties?.role || '';
            const name = node.properties?.name || roleDesc.split(' ').slice(0, 4).join(' ') || 'Unnamed Agent';
            
            return {
              id: node.id,
              name,
              role: roleDesc,
              agentType,
              content: node.properties?.content || '',
              version: node.properties?.version || '1.0',
              created: node.created,
              // Metadata fields
              roleDescription: roleDesc,
              roleHash: node.properties?.roleHash || node.properties?.role_hash,
              charCount: node.properties?.charCount || node.properties?.char_count,
              usedCount: node.properties?.usedCount || node.properties?.used_count,
              lastUsed: node.properties?.lastUsed || node.properties?.last_used,
              generatedBy: node.properties?.generatedBy || node.properties?.generated_by
            };
          });
      }

      res.json({
        agents,
        hasMore: agents.length === parseInt(limit as string),
        total: agents.length
      });
    } catch (error) {
      console.error('Error fetching agents:', error);
      res.status(500).json({
        error: 'Failed to fetch agents',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/agents/:id
   * Get specific agent preamble
   */
  router.get('/agents/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const agent = await graphManager.getNode(id);
      
      if (!agent || agent.type !== 'preamble') {
        return res.status(404).json({ error: 'Agent not found' });
      }

      res.json({
        id: agent.id,
        name: agent.properties?.name || 'Unnamed Agent',
        role: agent.properties?.role || '',
        agentType: agent.properties?.agentType || 'worker',
        content: agent.properties?.content || '',
        version: agent.properties?.version || '1.0',
        created: agent.created,
        // Metadata fields
        roleDescription: agent.properties?.roleDescription,
        roleHash: agent.properties?.roleHash,
        charCount: agent.properties?.charCount,
        usedCount: agent.properties?.usedCount,
        lastUsed: agent.properties?.lastUsed,
        generatedBy: agent.properties?.generatedBy
      });
    } catch (error) {
      console.error('Error fetching agent:', error);
      res.status(500).json({
        error: 'Failed to fetch agent',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/agents
   * Create new agent preamble using Agentinator
   */
  router.post('/agents', async (req: Request, res: Response) => {
    try {
      const { roleDescription, agentType = 'worker', useAgentinator = true } = req.body;
      
      if (!roleDescription || typeof roleDescription !== 'string') {
        return res.status(400).json({ error: 'Role description is required' });
      }

      let preambleContent = '';
      let agentName = '';
      let role = roleDescription;

      // Extract name from role description
      agentName = roleDescription.split(' ').slice(0, 4).join(' ');

      if (useAgentinator) {
        console.log(`🤖 Generating ${agentType} preamble with Agentinator...`);
        const generated = await generatePreambleWithAgentinator(roleDescription, agentType);
        agentName = generated.name;
        role = generated.role;
        preambleContent = generated.content;
        console.log(`✅ Generated preamble: ${agentName} (${preambleContent.length} chars)`);
      } else {
        // Create minimal preamble
        preambleContent = `# ${agentName} Agent\n\n` +
          `**Role:** ${roleDescription}\n\n` +
          `Execute tasks according to the role description above.\n`;
      }

      // Generate role hash for caching (MD5 of role description)
      const crypto = await import('crypto');
      const roleHash = crypto.createHash('md5').update(roleDescription).digest('hex').substring(0, 8);

      // Store in Neo4j with full metadata
      const preambleNode = await graphManager.addNode('preamble', {
        name: agentName,
        role,
        agentType,
        content: preambleContent,
        version: '1.0',
        created: new Date().toISOString(),
        generatedBy: useAgentinator ? 'agentinator' : 'manual',
        roleDescription,
        roleHash,
        charCount: preambleContent.length,
        usedCount: 1,
        lastUsed: new Date().toISOString()
      });

      res.json({
        success: true,
        agent: {
          id: preambleNode.id,
          name: agentName,
          role,
          agentType,
          content: preambleContent,
          version: '1.0',
          created: preambleNode.created
        }
      });
    } catch (error) {
      console.error('Error creating agent:', error);
      res.status(500).json({
        error: 'Failed to create agent',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/agents/:id
   * Delete an agent preamble
   */
  router.delete('/agents/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Don't allow deleting default agents
      if (id.startsWith('default-')) {
        return res.status(403).json({ error: 'Cannot delete default agents' });
      }
      
      const agent = await graphManager.getNode(id);
      
      if (!agent || agent.type !== 'preamble') {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      await graphManager.deleteNode(id);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting agent:', error);
      res.status(500).json({
        error: 'Failed to delete agent',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/generate-plan
   * Generate a task plan using the PM agent from a project prompt
   */
  router.post('/generate-plan', async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      // Load PM agent preamble (JSON version)
      const pmPreamblePath = path.join(__dirname, '../../docs/agents/v2/01-pm-preamble-json.md');
      const pmPreamble = await fs.readFile(pmPreamblePath, 'utf-8');

      // Create PM agent client
      const pmAgent = new CopilotAgentClient({
        preamblePath: pmPreamblePath,
        model: CopilotModel.GPT_4_TURBO,
        temperature: 0.2, // Lower temperature for structured output
        agentType: 'pm',
      });

      // Load preamble
      await pmAgent.loadPreamble(pmPreamblePath);

      // Build user request with repository context
      const userRequest = `${prompt}

**REPOSITORY CONTEXT:**

Project: Mimir - Graph-RAG TODO tracking with multi-agent orchestration
Location: ${process.cwd()}

**AVAILABLE TOOLS:**
- read_file(path) - Read file contents
- edit_file(path, content) - Create or modify files
- run_terminal_cmd(command) - Execute shell commands
- grep(pattern, path, options) - Search file contents
- list_dir(path) - List directory contents
- memory_node, memory_edge - Graph database operations

**IMPORTANT:** Output ONLY valid JSON matching the ProjectPlan interface. No markdown, no explanations.`;

      console.log('🤖 Invoking PM Agent to generate task plan...');
      
      // Execute PM agent
      const result = await pmAgent.execute(userRequest);
      const response = result.output;

      // Parse JSON response
      let plan: any;
      try {
        // Extract JSON from response (in case there's any text before/after)
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON object found in PM agent response');
        }
        
        plan = JSON.parse(jsonMatch[0]);
        
        // Validate required fields
        if (!plan.overview || !plan.tasks || !Array.isArray(plan.tasks)) {
          throw new Error('Invalid plan structure: missing required fields');
        }
        
        console.log(`✅ PM Agent generated ${plan.tasks.length} tasks`);
      } catch (parseError) {
        console.error('Failed to parse PM agent response:', parseError);
        console.error('Raw response:', response.substring(0, 500));
        
        // Return error with partial response for debugging
        return res.status(500).json({
          error: 'Failed to parse PM agent response',
          details: parseError instanceof Error ? parseError.message : 'Invalid JSON',
          rawResponse: response.substring(0, 1000),
        });
      }

      // Store the generated plan in Mimir for future reference
      await graphManager.addNode('memory', {
        type: 'orchestration_plan',
        title: `Plan: ${plan.overview.goal}`,
        content: JSON.stringify(plan, null, 2),
        prompt: prompt,
        category: 'orchestration',
        timestamp: new Date().toISOString(),
        taskCount: plan.tasks.length,
      });

      res.json(plan);
    } catch (error) {
      console.error('Error generating plan:', error);
      res.status(500).json({ 
        error: 'Failed to generate plan',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/save-plan
   * Save a task plan to the Mimir knowledge graph
   */
  router.post('/save-plan', async (req: Request, res: Response) => {
    try {
      const { plan } = req.body;
      
      if (!plan) {
        return res.status(400).json({ error: 'Plan is required' });
      }

      // Validate plan structure
      if (!Array.isArray(plan.tasks)) {
        return res.status(400).json({ error: 'Plan must contain a tasks array' });
      }
      
      const tasks = plan.tasks as any[]; // Type-safe after validation

      // Create a project node
      const projectNode = await graphManager.addNode('project', {
        title: plan.overview.goal,
        complexity: plan.overview.complexity,
        totalTasks: plan.overview.totalTasks,
        estimatedDuration: plan.overview.estimatedDuration,
        estimatedToolCalls: plan.overview.estimatedToolCalls,
        reasoning: JSON.stringify(plan.reasoning),
        created: new Date().toISOString(),
      });

      // Create task nodes and link to project
      const taskNodeIds: string[] = [];
      for (const task of tasks) {
        const taskNode = await graphManager.addNode('todo', {
          title: task.title,
          description: task.prompt,
          agentRole: task.agentRoleDescription,
          model: task.recommendedModel,
          status: 'pending',
          priority: 'medium',
          parallelGroup: task.parallelGroup,
          estimatedDuration: task.estimatedDuration,
          estimatedToolCalls: task.estimatedToolCalls,
          dependencies: JSON.stringify(task.dependencies),
          successCriteria: JSON.stringify(task.successCriteria),
          verificationCriteria: JSON.stringify(task.verificationCriteria),
          maxRetries: task.maxRetries,
        });

        taskNodeIds.push(taskNode.id);

        // Link task to project
        await graphManager.addEdge(taskNode.id, projectNode.id, 'belongs_to', {});
      }

      // Create dependency edges between tasks
      if (Array.isArray(tasks)) {
        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];
          const taskNodeId = taskNodeIds[i];

          if (Array.isArray(task.dependencies)) {
            for (const depTaskId of task.dependencies) {
              const depIndex = tasks.findIndex((t: any) => t.id === depTaskId);
              if (depIndex !== -1) {
                await graphManager.addEdge(taskNodeId, taskNodeIds[depIndex], 'depends_on', {});
              }
            }
          }
        }
      }

      res.json({ 
        success: true,
        projectId: projectNode.id,
        taskIds: taskNodeIds,
      });
    } catch (error) {
      console.error('Error saving plan:', error);
      res.status(500).json({ 
        error: 'Failed to save plan',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/plans
   * Retrieve all saved orchestration plans
   */
  router.get('/plans', async (req: Request, res: Response) => {
    try {
      const projects = await graphManager.queryNodes('project');

      const plans = await Promise.all(
        projects.map(async (project) => {
          // Get all tasks linked to this project
          const neighbors = await graphManager.getNeighbors(project.id, 'belongs_to');

          return {
            id: project.id,
            overview: {
              goal: project.properties?.title || 'Untitled',
              complexity: project.properties?.complexity || 'Medium',
              totalTasks: project.properties?.totalTasks || 0,
              estimatedDuration: project.properties?.estimatedDuration || 'TBD',
              estimatedToolCalls: project.properties?.estimatedToolCalls || 0,
            },
            taskCount: neighbors.length,
            created: project.created,
          };
        })
      );

      res.json({ plans });
    } catch (error) {
      console.error('Error retrieving plans:', error);
      res.status(500).json({ 
        error: 'Failed to retrieve plans',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}

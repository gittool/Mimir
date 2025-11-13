import { create } from 'zustand';
import { Task, ProjectPlan, ParallelGroup, AgentTemplate, CreateAgentRequest } from '../types/task';
import { apiClient, ApiError } from '../utils/api';

interface PlanState {
  projectPrompt: string;
  projectPlan: ProjectPlan | null;
  tasks: Task[];
  parallelGroups: ParallelGroup[];
  selectedTask: Task | null;
  agentTemplates: AgentTemplate[];
  agentSearch: string;
  agentOffset: number;
  hasMoreAgents: boolean;
  isLoadingAgents: boolean;
  selectedAgent: AgentTemplate | null;
  agentOperations: Record<string, boolean>; // Track loading states by agent ID
  globalError: ApiError | null; // Global error state
  
  // Actions
  setProjectPrompt: (prompt: string) => void;
  setProjectPlan: (plan: ProjectPlan) => void;
  setGlobalError: (error: ApiError | null) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  deleteTask: (taskId: string) => void;
  reorderTask: (taskId: string, newOrder: number) => void;
  addParallelGroup: () => void;
  updateParallelGroup: (groupId: number, updates: Partial<ParallelGroup>) => void;
  deleteParallelGroup: (groupId: number) => void;
  assignTaskToGroup: (taskId: string, groupId: number | null) => void;
  setSelectedTask: (task: Task | null) => void;
  exportToMarkdown: () => string;
  reset: () => void;
  
  // Agent management
  fetchAgents: (search?: string, reset?: boolean) => Promise<void>;
  createAgent: (request: CreateAgentRequest) => Promise<AgentTemplate>;
  deleteAgent: (agentId: string) => Promise<void>;
  setAgentSearch: (search: string) => void;
  setSelectedAgent: (agent: AgentTemplate | null) => void;
}

const groupColors = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
];

// Default placeholder agents (always available, cannot be deleted)
const DEFAULT_AGENTS: AgentTemplate[] = [
  {
    id: 'default-devops',
    name: 'DevOps Engineer',
    role: 'DevOps engineer specializing in CI/CD, containerization, and infrastructure automation',
    agentType: 'worker',
    content: '# DevOps Engineer Agent\n\nExecute DevOps tasks with expertise in automation and deployment.',
    version: '1.0',
    created: new Date().toISOString(),
  },
  {
    id: 'default-backend',
    name: 'Backend Developer',
    role: 'Backend developer with expertise in API design, databases, and server-side logic',
    agentType: 'worker',
    content: '# Backend Developer Agent\n\nBuild robust backend services and APIs.',
    version: '1.0',
    created: new Date().toISOString(),
  },
  {
    id: 'default-frontend',
    name: 'Frontend Developer',
    role: 'Frontend developer specializing in React, TypeScript, and modern UI/UX',
    agentType: 'worker',
    content: '# Frontend Developer Agent\n\nCreate engaging user interfaces.',
    version: '1.0',
    created: new Date().toISOString(),
  },
  {
    id: 'default-qc-general',
    name: 'QC Specialist',
    role: 'Quality control specialist who validates code quality, tests, and documentation',
    agentType: 'qc',
    content: '# QC Specialist Agent\n\nVerify quality and correctness of implementations.',
    version: '1.0',
    created: new Date().toISOString(),
  },
  {
    id: 'default-qc-security',
    name: 'Security QC',
    role: 'Security-focused QC agent who validates security best practices, vulnerabilities, and compliance',
    agentType: 'qc',
    content: '# Security QC Agent\n\nVerify security implementations and identify vulnerabilities.',
    version: '1.0',
    created: new Date().toISOString(),
  },
  {
    id: 'default-qc-performance',
    name: 'Performance QC',
    role: 'Performance-focused QC agent who validates efficiency, scalability, and resource usage',
    agentType: 'qc',
    content: '# Performance QC Agent\n\nVerify performance optimizations and scalability.',
    version: '1.0',
    created: new Date().toISOString(),
  },
  {
    id: 'default-qc-ux',
    name: 'UX/Accessibility QC',
    role: 'UX and accessibility QC agent who validates user experience, accessibility standards, and usability',
    agentType: 'qc',
    content: '# UX/Accessibility QC Agent\n\nVerify user experience and accessibility compliance.',
    version: '1.0',
    created: new Date().toISOString(),
  },
  {
    id: 'default-architect',
    name: 'Solutions Architect',
    role: 'Solutions architect with expertise in system design, scalability, and best practices',
    agentType: 'worker',
    content: '# Solutions Architect Agent\n\nDesign scalable and maintainable architectures.',
    version: '1.0',
    created: new Date().toISOString(),
  },
];

export const usePlanStore = create<PlanState>((set, get) => {
  // Initialize API error handler
  apiClient.setErrorHandler((error) => {
    set({ globalError: error });
  });
  
  return {
  projectPrompt: '',
  projectPlan: null,
  tasks: [],
  parallelGroups: [],
  selectedTask: null,
  agentTemplates: [...DEFAULT_AGENTS], // Start with default agents
  agentSearch: '',
  agentOffset: 0,
  hasMoreAgents: true,
  isLoadingAgents: false,
  selectedAgent: null,
  agentOperations: {},
  globalError: null,
  
  setProjectPrompt: (prompt) => set({ projectPrompt: prompt }),
  
  setGlobalError: (error) => set({ globalError: error }),
  
  setProjectPlan: (plan) => set({ 
    projectPlan: plan,
    tasks: plan.tasks,
    parallelGroups: plan.parallelGroups,
  }),
  
  addTask: (task) => set((state) => {
    // Auto-assign order for ungrouped tasks
    if (task.parallelGroup === null && task.order === undefined) {
      const maxOrder = state.tasks
        .filter(t => t.parallelGroup === null)
        .reduce((max, t) => Math.max(max, t.order ?? 0), 0);
      task.order = maxOrder + 1;
    }
    return {
      tasks: [...state.tasks, task],
    };
  }),
  
  updateTask: (taskId, updates) => set((state) => ({
    tasks: state.tasks.map((t) => 
      t.id === taskId ? { ...t, ...updates } : t
    ),
  })),
  
  deleteTask: (taskId) => set((state) => ({
    tasks: state.tasks.filter((t) => t.id !== taskId),
    parallelGroups: state.parallelGroups.map((g) => ({
      ...g,
      taskIds: g.taskIds.filter((id) => id !== taskId),
    })),
  })),
  
  reorderTask: (taskId, newOrder) => set((state) => {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || task.parallelGroup !== null) return state;
    
    const ungroupedTasks = state.tasks
      .filter(t => t.parallelGroup === null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    
    const oldIndex = ungroupedTasks.findIndex(t => t.id === taskId);
    if (oldIndex === -1) return state;
    
    // Remove from old position
    const [movedTask] = ungroupedTasks.splice(oldIndex, 1);
    
    // Insert at new position
    const newIndex = Math.min(Math.max(0, newOrder), ungroupedTasks.length);
    ungroupedTasks.splice(newIndex, 0, movedTask);
    
    // Reassign order values
    const updatedTasks = state.tasks.map(t => {
      if (t.parallelGroup !== null) return t;
      const index = ungroupedTasks.findIndex(ut => ut.id === t.id);
      return index !== -1 ? { ...t, order: index } : t;
    });
    
    return { tasks: updatedTasks };
  }),
  
  addParallelGroup: () => set((state) => {
    const newId = Math.max(0, ...state.parallelGroups.map(g => g.id)) + 1;
    return {
      parallelGroups: [
        ...state.parallelGroups,
        {
          id: newId,
          name: `Group ${newId}`,
          taskIds: [],
          color: groupColors[newId % groupColors.length],
        },
      ],
    };
  }),
  
  updateParallelGroup: (groupId, updates) => set((state) => ({
    parallelGroups: state.parallelGroups.map((g) =>
      g.id === groupId ? { ...g, ...updates } : g
    ),
  })),
  
  deleteParallelGroup: (groupId) => set((state) => ({
    parallelGroups: state.parallelGroups.filter((g) => g.id !== groupId),
    tasks: state.tasks.map((t) =>
      t.parallelGroup === groupId ? { ...t, parallelGroup: null } : t
    ),
  })),
  
  assignTaskToGroup: (taskId, groupId) => set((state) => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return state;
    
    // Remove from old group
    const parallelGroups = state.parallelGroups.map((g) => ({
      ...g,
      taskIds: g.taskIds.filter((id) => id !== taskId),
    }));
    
    // Add to new group if specified
    if (groupId !== null) {
      const groupIndex = parallelGroups.findIndex((g) => g.id === groupId);
      if (groupIndex !== -1) {
        parallelGroups[groupIndex].taskIds.push(taskId);
      }
    }
    
    return {
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, parallelGroup: groupId } : t
      ),
      parallelGroups,
    };
  }),
  
  setSelectedTask: (task) => set({ selectedTask: task }),
  
  exportToMarkdown: () => {
    const state = get();
    const { projectPlan, tasks, parallelGroups } = state;
    
    if (!projectPlan) return '';
    
    let markdown = `# Task Decomposition Plan\n\n`;
    markdown += `## Project Overview\n`;
    markdown += `**Goal:** ${projectPlan.overview.goal}\n`;
    markdown += `**Complexity:** ${projectPlan.overview.complexity}\n`;
    markdown += `**Total Tasks:** ${projectPlan.overview.totalTasks}\n`;
    markdown += `**Estimated Duration:** ${projectPlan.overview.estimatedDuration}\n`;
    markdown += `**Estimated Tool Calls:** ${projectPlan.overview.estimatedToolCalls}\n\n`;
    
    markdown += `<reasoning>\n`;
    markdown += `## Requirements Analysis\n${projectPlan.reasoning.requirementsAnalysis}\n\n`;
    markdown += `## Complexity Assessment\n${projectPlan.reasoning.complexityAssessment}\n\n`;
    markdown += `## Repository Context\n${projectPlan.reasoning.repositoryContext}\n\n`;
    markdown += `## Decomposition Strategy\n${projectPlan.reasoning.decompositionStrategy}\n\n`;
    markdown += `## Task Breakdown\n${projectPlan.reasoning.taskBreakdown}\n`;
    markdown += `</reasoning>\n\n`;
    
    markdown += `---\n\n`;
    markdown += `## Task Graph\n\n`;
    
    tasks.forEach((task) => {
      markdown += `**Task ID:** ${task.id}\n\n`;
      markdown += `**Title:** ${task.title}\n\n`;
      markdown += `**Agent Role Description:** ${task.agentRoleDescription}\n\n`;
      markdown += `**Recommended Model:** ${task.recommendedModel}\n\n`;
      markdown += `**Prompt:**\n${task.prompt}\n\n`;
      
      if (task.context) {
        markdown += `**Context:**\n${task.context}\n\n`;
      }
      
      if (task.toolBasedExecution) {
        markdown += `**Tool-Based Execution:**\n${task.toolBasedExecution}\n\n`;
      }
      
      markdown += `**Success Criteria:**\n`;
      task.successCriteria.forEach((criterion) => {
        markdown += `- [ ] ${criterion}\n`;
      });
      markdown += `\n`;
      
      markdown += `**Dependencies:** ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'None'}\n\n`;
      markdown += `**Estimated Duration:** ${task.estimatedDuration}\n\n`;
      markdown += `**Estimated Tool Calls:** ${task.estimatedToolCalls}\n\n`;
      markdown += `**Parallel Group:** ${task.parallelGroup ?? 'N/A'}\n\n`;
      markdown += `**QC Agent Role Description:** ${task.qcAgentRoleDescription}\n\n`;
      markdown += `**Verification Criteria:**\n`;
      task.verificationCriteria.forEach((criterion) => {
        markdown += `- [ ] ${criterion}\n`;
      });
      markdown += `\n`;
      markdown += `**Max Retries:** ${task.maxRetries}\n\n`;
      markdown += `---\n\n`;
    });
    
    markdown += `## Dependency Summary\n\n`;
    markdown += `**Parallel Groups:**\n`;
    parallelGroups.forEach((group) => {
      const groupTasks = tasks.filter((t) => group.taskIds.includes(t.id));
      markdown += `- Group ${group.id}: ${groupTasks.map(t => t.id).join(', ')}\n`;
    });
    
    return markdown;
  },
  
  reset: () => set({
    projectPrompt: '',
    projectPlan: null,
    tasks: [],
    parallelGroups: [],
    selectedTask: null,
  }),
  
       // Agent management
  fetchAgents: async (search, reset) => {
    const state = get();
    if (reset) {
      set({ agentOffset: 0, hasMoreAgents: true, isLoadingAgents: true });
    } else {
      set({ isLoadingAgents: true });
    }
    
    const offset = reset ? 0 : state.agentOffset;
    const limit = 20;
    
    try {
      const searchParam = search || state.agentSearch || '';
      const data = await apiClient.get<{ agents: AgentTemplate[]; hasMore: boolean }>
        (`/agents?search=${encodeURIComponent(searchParam)}&offset=${offset}&limit=${limit}`);
      
      // Filter default agents based on search query (always use DEFAULT_AGENTS constant)
      const filteredDefaultAgents = searchParam 
        ? DEFAULT_AGENTS.filter(agent => 
            agent.name.toLowerCase().includes(searchParam.toLowerCase()) ||
            agent.role.toLowerCase().includes(searchParam.toLowerCase())
          )
        : DEFAULT_AGENTS;
      
      // If we got agents from API, use them; otherwise keep existing agents (including filtered defaults)
      if (data.agents && data.agents.length > 0) {
        set((state) => {
          const nonDefaultAgents = state.agentTemplates.filter(a => !a.id.startsWith('default-'));
          
          // When resetting, keep filtered defaults + new API agents
          // When not resetting, keep filtered defaults + existing non-defaults + append new API agents
          const newAgents = reset 
            ? [...filteredDefaultAgents, ...data.agents]
            : [...filteredDefaultAgents, ...nonDefaultAgents, ...data.agents];
          
          return {
            agentTemplates: newAgents,
            agentOffset: offset + data.agents.length,
            hasMoreAgents: data.hasMore,
            isLoadingAgents: false,
          };
        });
      } else {
        // No agents from API - show only filtered defaults
        set({
          agentTemplates: filteredDefaultAgents,
          agentOffset: 0,
          hasMoreAgents: false,
          isLoadingAgents: false,
        });
      }
    } catch (error) {
      console.warn('Failed to fetch agents from API, using filtered defaults:', error);
      // On error, still filter defaults if searching (always use DEFAULT_AGENTS constant)
      const searchParam = search || state.agentSearch || '';
      const filteredDefaultAgents = searchParam 
        ? DEFAULT_AGENTS.filter(agent => 
            agent.name.toLowerCase().includes(searchParam.toLowerCase()) ||
            agent.role.toLowerCase().includes(searchParam.toLowerCase())
          )
        : DEFAULT_AGENTS;
      
      set({ 
        agentTemplates: filteredDefaultAgents,
        isLoadingAgents: false 
      });
    }
  },
   
   createAgent: async (request) => {
     const data = await apiClient.post<{ agent: AgentTemplate }>('/agents', request);
     const newAgent = data.agent;
     
     set((state) => ({
       agentTemplates: [newAgent, ...state.agentTemplates],
     }));
     
     return newAgent;
   },
  
  setAgentSearch: (search) => set({ agentSearch: search }),
  
  deleteAgent: async (agentId) => {
    // Don't allow deleting default agents
    if (agentId.startsWith('default-')) {
      console.warn('Cannot delete default agents');
      return;
    }
    
    // Set loading state for this agent
    set((state) => ({
      agentOperations: { ...state.agentOperations, [agentId]: true }
    }));
    
    try {
      await apiClient.delete(`/agents/${agentId}`);
      
      // Remove from list
      set((state) => ({
        agentTemplates: state.agentTemplates.filter(a => a.id !== agentId),
        agentOperations: { ...state.agentOperations, [agentId]: false },
        selectedAgent: state.selectedAgent?.id === agentId ? null : state.selectedAgent,
      }));
    } catch (error) {
      // Clear loading state on error
      set((state) => ({
        agentOperations: { ...state.agentOperations, [agentId]: false }
      }));
      throw error;
    }
  },
  
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
};
});

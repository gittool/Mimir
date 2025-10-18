import { ChatOpenAI } from '@langchain/openai';
import { ChatOllama } from '@langchain/ollama';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CompiledStateGraph } from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import fs from 'fs/promises';
import { CopilotModel, LLMProvider } from './types.js';
import { allTools, planningTools, getToolNames } from './tools.js';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { LLMConfigLoader } from '../config/LLMConfigLoader.js';


export interface AgentConfig {
  preamblePath: string;
  model?: CopilotModel | string;
  temperature?: number;
  maxTokens?: number;
  tools?: StructuredToolInterface[]; // Allow custom tool set
  
  // Provider Configuration (NEW)
  provider?: LLMProvider | string;
  agentType?: 'pm' | 'worker' | 'qc'; // For config defaults
  
  // Provider-specific options
  ollamaBaseUrl?: string;
  copilotBaseUrl?: string;
  openAIApiKey?: string;
  fallbackProvider?: LLMProvider | string;
}

// Re-export LLMProvider for convenience
export { LLMProvider };

/**
 * Client for GitHub Copilot Chat API via copilot-api proxy
 * WITH FULL AGENT MODE (tool calling enabled) using LangChain 1.0.1 + LangGraph
 * 
 * @example
 * ```typescript
 * const client = new CopilotAgentClient({
 *   preamblePath: 'agent.md',
 *   model: CopilotModel.GPT_4_1,  // Use enum for autocomplete!
 *   temperature: 0.0,
 * });
 * await client.loadPreamble('agent.md');
 * const result = await client.execute('Debug the order processing system');
 * ```
 */
export class CopilotAgentClient {
  private llm: BaseChatModel | null = null; // Initialize in loadPreamble
  private agent: CompiledStateGraph<any, any> | null = null;
  private systemPrompt: string = '';
  private maxIterations: number = 50; // Prevent infinite loops
  private tools: StructuredToolInterface[];
  
  // Provider abstraction fields (NEW)
  private provider: LLMProvider = LLMProvider.OLLAMA; // Default
  private modelName: string = 'tinyllama'; // Default
  private baseURL: string = 'http://localhost:11434'; // Default
  private llmConfig: Record<string, any> = {};
  private configLoader: LLMConfigLoader;
  private agentConfig: AgentConfig; // Store for lazy initialization

  constructor(config: AgentConfig) {
    // Use custom tools if provided, otherwise default to allTools
    this.tools = config.tools || allTools;
    
    // Store config for lazy initialization in loadPreamble
    this.agentConfig = config;
    
    // Validate provider if specified
    if (config.provider && !Object.values(LLMProvider).includes(config.provider as LLMProvider)) {
      throw new Error(`Unknown provider: ${config.provider}. Valid options: ${Object.values(LLMProvider).join(', ')}`);
    }
    
    // Validate OpenAI API key if using OpenAI provider
    if (config.provider === LLMProvider.OPENAI && !config.openAIApiKey && !process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key required for OpenAI provider. Provide via config.openAIApiKey or OPENAI_API_KEY environment variable.');
    }
    
    // Load config loader (synchronous singleton access)
    this.configLoader = LLMConfigLoader.getInstance();
    
    console.log(`🔧 Tools available (${this.tools.length}): ${this.tools.map(t => t.name).slice(0, 10).join(', ')}${this.tools.length > 10 ? '...' : ''}`);
  }
  
  // Public getter methods for testing
  public getProvider(): LLMProvider {
    // Return default until initialized
    if (!this.llm) {
      // Return what would be initialized based on config
      if (this.agentConfig.provider) {
        return this.agentConfig.provider as LLMProvider;
      }
      // If using CopilotModel enum, infer Copilot provider for backward compatibility
      if (this.agentConfig.model && Object.values(CopilotModel).includes(this.agentConfig.model as any)) {
        return LLMProvider.COPILOT;
      }
      // Default to OLLAMA (post-migration default)
      return LLMProvider.OLLAMA;
    }
    return this.provider;
  }
  
  public getModel(): string {
    if (!this.llm) {
      if (this.agentConfig.model) {
        // Handle CopilotModel enum - extract the string value
        const modelValue = this.agentConfig.model.toString();
        // Map enum values to actual model names
        if (modelValue === 'gpt-4.1') return 'gpt-4o'; // GPT_4_1 enum maps to gpt-4o
        return modelValue;
      }
      // Default to tinyllama for Ollama
      return 'tinyllama';
    }
    return this.modelName;
  }
  
  public getBaseURL(): string {
    if (!this.llm) {
      // Return what would be set based on config
      if (this.agentConfig.provider === LLMProvider.OLLAMA) {
        return this.agentConfig.ollamaBaseUrl || 'http://localhost:11434';
      } else if (this.agentConfig.provider === LLMProvider.COPILOT) {
        return this.agentConfig.copilotBaseUrl || 'http://localhost:4141/v1';
      } else if (this.agentConfig.provider === LLMProvider.OPENAI) {
        return 'https://api.openai.com/v1';
      }
      // Default to Ollama
      return this.agentConfig.ollamaBaseUrl || 'http://localhost:11434';
    }
    return this.baseURL;
  }
  
  public getLLMConfig(): Record<string, any> {
    if (!this.llm) {
      // Return defaults based on provider before initialization
      const provider = this.getProvider();
      if (provider === LLMProvider.OLLAMA) {
        return {
          numCtx: 8192,
          numPredict: -1,
          temperature: this.agentConfig.temperature ?? 0.0,
        };
      } else {
        // Copilot/OpenAI
        return {
          maxTokens: this.agentConfig.maxTokens ?? -1,
          temperature: this.agentConfig.temperature ?? 0.0,
        };
      }
    }
    return this.llmConfig;
  }
  
  public async getContextWindow(): Promise<number> {
    const provider = this.getProvider();
    const model = this.getModel();
    return this.configLoader.getContextWindow(provider, model);
  }

  async loadPreamble(path: string): Promise<void> {
    // Initialize LLM if not already done
    if (!this.llm) {
      await this.initializeLLM();
    }
    
    this.systemPrompt = await fs.readFile(path, 'utf-8');
    
    // Display context window information
    const contextWindow = await this.getContextWindow();
    console.log(`📊 Context Window: ${contextWindow.toLocaleString()} tokens`);
    
    // Display model-specific warnings if any
    await this.configLoader.displayModelWarnings(this.provider, this.modelName);
    
    // Add tool usage instructions to the system prompt
    const enhancedSystemPrompt = `${this.systemPrompt}

---

## IMPORTANT: TOOL USAGE

You have access to the following tools that you MUST use to complete your task:

- **run_terminal_cmd**: Execute shell commands (npm test, grep, etc.)
- **read_file**: Read file contents
- **write**: Create/overwrite files  
- **search_replace**: Edit files
- **list_dir**: List directory contents
- **grep**: Search files with regex
- **delete_file**: Delete files

**YOU MUST USE THESE TOOLS.** Do not just describe what you would do - ACTUALLY DO IT using the tools.

Example of WRONG approach:
❌ "I would run npm test to check for failures..."

Example of CORRECT approach:
✅ Use run_terminal_cmd with command "npm test testing/agentic/order-processor-v2.test.ts"
✅ Use read_file with target_file "testing/agentic/AGENTS.md"
✅ Use write to create reproduction tests

Start by using read_file to read AGENTS.md, then use run_terminal_cmd to run tests, then continue investigating with tools.`;
    
    // Create React agent using the new LangGraph API
    this.agent = createReactAgent({
      llm: this.llm!,
      tools: this.tools,
      prompt: new SystemMessage(enhancedSystemPrompt),
    });

    console.log('✅ Agent initialized with tool-calling enabled using LangGraph');
  }
  
  private async initializeLLM(): Promise<void> {
    const config = this.agentConfig;
    
    // Determine provider (with fallback chain)
    let provider: LLMProvider;
    let model: string;
    
    if (config.provider) {
      // Explicit provider specified
      provider = config.provider as LLMProvider;
      model = config.model || await this.getDefaultModelForProvider(provider);
    } else if (config.agentType) {
      // Use agent type defaults from config
      const defaults = await this.configLoader.getAgentDefaults(config.agentType);
      provider = defaults.provider as LLMProvider;
      model = defaults.model;
    } else if (config.model && Object.values(CopilotModel).includes(config.model as any)) {
      // If using CopilotModel enum, infer Copilot provider for backward compatibility
      provider = LLMProvider.COPILOT;
      model = config.model;
    } else {
      // Read default provider from config file (if available)
      try {
        const llmConfig = await this.configLoader.load();
        
        // If config explicitly sets defaultProvider, use it
        if (llmConfig.defaultProvider) {
          provider = llmConfig.defaultProvider as LLMProvider;
          model = config.model || await this.getDefaultModelForProvider(provider);
        } else {
          // Config exists but no defaultProvider set - use Ollama as default
          provider = LLMProvider.OLLAMA;
          model = config.model || 'tinyllama';
        }
      } catch (error) {
        // No config file - use Ollama as default
        provider = LLMProvider.OLLAMA;
        model = config.model || 'tinyllama';
      }
    }
    
    // Validate provider
    if (!Object.values(LLMProvider).includes(provider)) {
      throw new Error(`Unknown provider: ${provider}. Valid options: ${Object.values(LLMProvider).join(', ')}`);
    }
    
    this.provider = provider;
    this.modelName = model;
    
    // Initialize provider-specific configuration
    switch (provider) {
      case LLMProvider.OLLAMA:
        await this.initializeOllama(config, model);
        break;
      case LLMProvider.COPILOT:
        await this.initializeCopilot(config, model);
        break;
      case LLMProvider.OPENAI:
        await this.initializeOpenAI(config, model);
        break;
      default:
        throw new Error(`Provider ${provider} not implemented`);
    }
    
    console.log(`🤖 Model: ${this.modelName} via ${this.provider}`);
  }
  
  private async getDefaultModelForProvider(provider: LLMProvider): Promise<string> {
    const config = await this.configLoader.load();
    switch (provider) {
      case LLMProvider.OLLAMA:
        return config.providers.ollama?.defaultModel || 'tinyllama';
      case LLMProvider.COPILOT:
        return config.providers.copilot?.defaultModel || CopilotModel.GPT_4O;
      case LLMProvider.OPENAI:
        return 'gpt-4-turbo';
      default:
        return 'tinyllama'; // Default to Ollama model
    }
  }
  
  private async initializeOllama(config: AgentConfig, model: string): Promise<void> {
    const llmConfig = await this.configLoader.load();
    const modelConfig = await this.configLoader.getModelConfig(LLMProvider.OLLAMA, model);
    const contextWindow = await this.configLoader.getContextWindow(LLMProvider.OLLAMA, model);
    
    this.baseURL = config.ollamaBaseUrl || llmConfig.providers.ollama?.baseUrl || 'http://localhost:11434';
    this.llmConfig = {
      numCtx: modelConfig?.config?.numCtx || contextWindow || 8192,
      numPredict: modelConfig?.config?.numPredict || -1,
      temperature: config.temperature ?? modelConfig?.config?.temperature ?? 0.0,
    };
    
    this.llm = new ChatOllama({
      baseUrl: this.baseURL,
      model: model,
      numCtx: this.llmConfig.numCtx,
      numPredict: this.llmConfig.numPredict,
      temperature: this.llmConfig.temperature,
    });
  }
  
  private async initializeCopilot(config: AgentConfig, model: string): Promise<void> {
    const llmConfig = await this.configLoader.load();
    const modelConfig = await this.configLoader.getModelConfig(LLMProvider.COPILOT, model);
    const contextWindow = await this.configLoader.getContextWindow(LLMProvider.COPILOT, model);
    
    this.baseURL = config.copilotBaseUrl || llmConfig.providers.copilot?.baseUrl || 'http://localhost:4141/v1';
    this.llmConfig = {
      maxTokens: config.maxTokens ?? modelConfig?.config?.maxTokens ?? -1,
      temperature: config.temperature ?? modelConfig?.config?.temperature ?? 0.0,
    };
    
    this.llm = new ChatOpenAI({
      apiKey: 'dummy-key-not-used', // Required by OpenAI client but not used by proxy
      model: model,
      configuration: {
        baseURL: this.baseURL,
      },
      temperature: this.llmConfig.temperature,
      maxTokens: this.llmConfig.maxTokens,
      streaming: false,
    });
  }
  
  private async initializeOpenAI(config: AgentConfig, model: string): Promise<void> {
    if (!config.openAIApiKey && !process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key required for OpenAI provider. Provide via config.openAIApiKey or OPENAI_API_KEY environment variable.');
    }
    
    const modelConfig = await this.configLoader.getModelConfig(LLMProvider.OPENAI, model);
    
    this.baseURL = 'https://api.openai.com/v1';
    this.llmConfig = {
      maxTokens: config.maxTokens ?? modelConfig?.config?.maxTokens ?? -1,
      temperature: config.temperature ?? modelConfig?.config?.temperature ?? 0.0,
    };
    
    this.llm = new ChatOpenAI({
      apiKey: config.openAIApiKey || process.env.OPENAI_API_KEY,
      model: model,
      temperature: this.llmConfig.temperature,
      maxTokens: this.llmConfig.maxTokens,
      streaming: false,
    });
  }

  async execute(task: string): Promise<{
    output: string;
    conversationHistory: Array<{ role: string; content: string }>;
    tokens: { input: number; output: number };
    toolCalls: number;
    intermediateSteps: any[];
  }> {
    if (!this.agent) {
      throw new Error('Agent not initialized. Call loadPreamble() first.');
    }

    console.log('\n🚀 Starting agent execution...\n');

    const startTime = Date.now();
    
    try {
      // LangGraph agents use messages format
      const result = await this.agent.invoke({
        messages: [new HumanMessage(task)],
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n✅ Agent completed in ${duration}s\n`);
      
      // Debug: Log what we actually got
      console.log('📦 Result keys:', Object.keys(result));
      console.log('📦 Result type:', typeof result);
      
      // Extract the final message from LangGraph result
      const messages = (result as any).messages || [];
      const lastMessage = messages[messages.length - 1];
      const output = lastMessage?.content || 'No response generated';
      
      if (!output || output.length === 0) {
        console.warn('⚠️  WARNING: Agent returned empty output!\n');
        console.warn('Full result:', JSON.stringify(result, null, 2));
      }

      // Extract conversation history from messages
      const conversationHistory: Array<{ role: string; content: string }> = [
        { role: 'system', content: this.systemPrompt },
      ];

      // Add all messages to conversation history
      for (const message of messages) {
        const role = (message as any)._getType() === 'human' ? 'user' : 
                    (message as any)._getType() === 'ai' ? 'assistant' : 
                    (message as any)._getType() === 'system' ? 'system' : 'tool';
        
        conversationHistory.push({
          role,
          content: (message as any).content,
        });
      }

      // Count tool calls from messages
      const toolCalls = messages.filter((msg: any) => 
        msg._getType() === 'ai' && msg.tool_calls && msg.tool_calls.length > 0
      ).length;

      return {
        output,
        conversationHistory,
        tokens: {
          input: this.estimateTokens(this.systemPrompt + task),
          output: this.estimateTokens(output),
        },
        toolCalls,
        intermediateSteps: messages as any[], // Return messages as intermediate steps
      };
    } catch (error: any) {
      console.error('\n❌ Agent execution failed:', error.message);
      console.error('Stack trace:', error.stack);
      throw error;
    }
  }

  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}


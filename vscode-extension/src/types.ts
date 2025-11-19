/**
 * Preamble/Chatmode definition
 */
export interface Preamble {
  name: string;
  filename: string;
  displayName: string;
}

/**
 * Chat message format
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Tool parameters for configurable Graph-RAG
 */
export interface ToolParameters {
  vector_search_nodes?: {
    limit?: number;
    min_similarity?: number;
    depth?: number;
    types?: string[];
  };
  memory_edge?: {
    depth?: number;
  };
}

/**
 * Chat completion request body
 */
export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
  enable_tools?: boolean;
  tools?: string[];
  max_tool_calls?: number;
  tool_parameters?: ToolParameters;
}

/**
 * Extension configuration
 */
export interface MimirConfig {
  apiUrl: string;
  defaultPreamble: string;
  model: string;
  vectorSearchDepth: number;
  vectorSearchLimit: number;
  vectorSearchMinSimilarity: number;
  enableTools: boolean;
  maxToolCalls: number;
  customPreamble: string;
}

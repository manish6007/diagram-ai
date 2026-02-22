export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  diagramSnapshot?: DiagramData;
  metadata?: {
    tokenCount?: number;
    processingTime?: number;
    error?: string;
  };
}

export interface DiagramData {
  id: string;
  format: 'drawio-xml';
  content: string;
  metadata: DiagramMetadata;
}

export interface DiagramMetadata {
  title: string;
  createdAt: Date;
  modifiedAt: Date;
  elementCount: number;
  bounds: {
    width: number;
    height: number;
  };
}

export interface Session {
  id: string;
  createdAt: Date;
  lastAccessedAt: Date;
  chatHistory: Message[];
  currentDiagram: DiagramData | null;
  config: ConfigState;
}

export interface ConfigState {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export type LLMProvider = 'openai' | 'anthropic' | 'bedrock' | 'google';

// MCP Types
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface MCPToolResult {
  toolName: string;
  result: any;
  error?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  serverName: string;
  lastChecked: Date;
  error?: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface ShapeUpdate {
  label?: string;
  position?: Position;
  width?: number;
  height?: number;
  style?: string;
}

// LLM Types
export interface LLMRequest {
  messages: LLMMessage[];
  tools?: LLMTool[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  result: any;
  error?: string;
}

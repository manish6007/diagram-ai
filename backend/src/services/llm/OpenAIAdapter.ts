import OpenAI from 'openai';
import { BaseLLMAdapter } from './BaseLLMAdapter';
import { LLMRequest, LLMResponse, ToolCall } from '../../types';

export class OpenAIAdapter extends BaseLLMAdapter {
  private client: OpenAI;

  constructor(apiKey: string, model: string = 'gpt-4') {
    super(apiKey, model);
    this.client = new OpenAI({ apiKey });
  }

  async callLLM(request: LLMRequest): Promise<LLMResponse> {
    const tools = request.tools?.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));

    let attempts = 0;
    const maxAttempts = 5;
    let delay = 2000; // Start with 2s delay

    while (attempts < maxAttempts) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model === 'gpt-4' ? 'gpt-4o-mini' : this.model, // Auto-upgrade gpt-4 to gpt-4o-mini
          messages: request.messages,
          tools: tools,
          temperature: request.temperature || 0.7,
          max_tokens: request.maxTokens || 4000
        });

        const message = response.choices[0].message;
        const toolCalls: ToolCall[] = message.tool_calls?.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments)
        })) || [];

        return {
          content: message.content || '',
          toolCalls,
          finishReason: response.choices[0].finish_reason
        };
      } catch (error: any) {
        attempts++;
        if (error.status === 429 && attempts < maxAttempts) {
          console.log(`Rate limit reached. Retrying in ${delay}ms... (Attempt ${attempts}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
        throw error;
      }
    }

    throw new Error('Max retry attempts reached');
  }
}

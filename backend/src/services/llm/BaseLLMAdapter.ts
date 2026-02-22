import { LLMRequest, LLMResponse } from '../../types';

export abstract class BaseLLMAdapter {
  protected apiKey: string;
  protected model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  abstract callLLM(request: LLMRequest): Promise<LLMResponse>;
}

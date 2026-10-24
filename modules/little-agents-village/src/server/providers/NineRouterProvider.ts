import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ModelProvider, ModelRequest, ModelResponse } from './ModelProvider';

const defaultBaseUrl = 'http://127.0.0.1:20128/v1';
const agentIds = ['mochi', 'foxy', 'luna', 'pip', 'bobo', 'ollie'] as const;

export function modelForAgent(agentId?: string) {
  if (agentId && agentIds.includes(agentId as typeof agentIds[number])) {
    const specific = process.env[`NINE_ROUTER_MODEL_${agentId.toUpperCase()}`]?.trim();
    if (specific) return specific;
  }
  const shared = process.env.NINE_ROUTER_MODEL?.trim();
  if (!shared) throw new Error('Set NINE_ROUTER_MODEL or a NINE_ROUTER_MODEL_<AGENT> value.');
  return shared;
}

export function routerConfiguration() {
  return {
    baseURL: (process.env.NINE_ROUTER_BASE_URL || defaultBaseUrl).replace(/\/+$/, ''),
    apiKey: process.env.NINE_ROUTER_API_KEY || 'local-no-key',
  };
}

export class NineRouterProvider implements ModelProvider {
  readonly id = '9router';
  private readonly client: OpenAI;

  constructor() {
    const config = routerConfiguration();
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      timeout: 45_000,
      maxRetries: 0,
    });
  }

  async listModels(signal?: AbortSignal) {
    const response = await this.client.models.list({ signal });
    return response.data.map((model) => model.id);
  }

  async generate(request: ModelRequest, options: { signal: AbortSignal; agentId?: string }): Promise<ModelResponse> {
    const model = modelForAgent(options.agentId);
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ];
    const tools: ChatCompletionTool[] = (request.tools ?? []).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    let inputTokens = 0;
    let outputTokens = 0;

    for (let round = 0; round < 5; round += 1) {
      const completion = await this.client.chat.completions.create({
        model,
        messages,
        ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
        max_tokens: 1200,
        temperature: 0.2,
      }, { signal: options.signal });
      inputTokens += completion.usage?.prompt_tokens ?? 0;
      outputTokens += completion.usage?.completion_tokens ?? 0;
      const choice = completion.choices[0];
      if (!choice) throw new Error('9Router returned no completion choice.');
      const calls = choice.message.tool_calls ?? [];
      if (!calls.length) {
        const text = choice.message.content;
        if (!text) throw new Error('9Router returned no text output.');
        return { text, inputTokens, outputTokens, model };
      }
      if (choice.finish_reason !== 'tool_calls' || !request.executeTool) {
        throw new Error('9Router requested a tool outside authorized execution context.');
      }
      messages.push(choice.message);
      for (const call of calls) {
        if (call.type !== 'function') throw new Error('Unsupported 9Router tool call type.');
        let result: unknown;
        try {
          result = await request.executeTool(call.function.name, JSON.parse(call.function.arguments));
        } catch (error) {
          result = { error: error instanceof Error ? error.message : 'Tool execution failed.' };
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 70_000),
        });
      }
    }
    throw new Error('9Router exceeded maximum authorized tool-call rounds.');
  }
}

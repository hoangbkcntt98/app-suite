import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ModelProvider, ModelRequest, ModelResponse } from './ModelProvider';

export class BedrockProvider implements ModelProvider {
  readonly id = 'amazon-bedrock';
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor() {
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
    this.modelId = process.env.LITTLE_AGENTS_MODEL_ID ?? '';
    if (!region || !this.modelId) throw new Error('Live AI unavailable: set AWS_REGION and LITTLE_AGENTS_MODEL_ID.');
    this.client = new BedrockRuntimeClient({ region });
  }

  async generate(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse> {
    const response = await this.client.send(new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: request.system }],
      messages: [{ role: 'user', content: [{ text: request.prompt }] }],
      inferenceConfig: { maxTokens: 1200, temperature: 0.2 },
    }), { abortSignal: options.signal });
    const text = response.output?.message?.content?.flatMap((block) => 'text' in block && block.text ? [block.text] : []).join('\n');
    if (!text) throw new Error('Provider returned no text output.');
    return {
      text,
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      model: this.modelId,
    };
  }
}

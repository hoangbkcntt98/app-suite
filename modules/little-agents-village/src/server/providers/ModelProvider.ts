export type ModelTool = { name: string; description: string; parameters: Record<string, unknown> };
export type ModelRequest = {
  system: string;
  prompt: string;
  tools?: ModelTool[];
  executeTool?: (name: string, input: unknown) => Promise<unknown>;
};
export type ModelResponse = { text: string; inputTokens: number; outputTokens: number; model: string };

export interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest, options: { signal: AbortSignal; agentId?: string }): Promise<ModelResponse>;
}

import { z } from 'zod';

export const liveAgentIds = ['mochi', 'luna', 'foxy', 'pip', 'bobo', 'ollie'] as const;
export const AgentResultSchema = z.object({
  taskId: z.string().uuid(),
  agentId: z.enum(liveAgentIds),
  status: z.enum(['completed', 'blocked', 'failed']),
  summary: z.string().min(1).max(6000),
  artifacts: z.array(z.string().max(500)).max(20),
  nextActions: z.array(z.string().max(500)).max(20),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

export const LiveTaskSchema = z.object({
  task: z.string().trim().min(5).max(2000).refine(
    (task) => !/(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|secret)\s*[:=]\s*\S+)/i.test(task),
    'Task contains a value that looks like a credential. Remove secrets before submitting.',
  ),
  memoryContext: z.array(z.object({
    summary: z.string().max(500),
    sourceEventIds: z.array(z.string()).max(10),
  })).max(8).optional(),
});
export type LiveTaskInput = z.infer<typeof LiveTaskSchema>;

export type LiveEvent = {
  eventId: string;
  runId: string;
  sequence: number;
  timestamp: string;
  agentId?: typeof liveAgentIds[number];
  type: 'stream.error' | 'run.created' | 'run.started' | 'run.completed' | 'run.failed' | 'run.cancelled'
    | 'agent.started' | 'agent.completed' | 'agent.failed' | 'agent.output.created'
    | 'agent.tool.requested' | 'agent.tool.started' | 'agent.tool.completed' | 'agent.tool.failed';
  payload: Record<string, unknown>;
};

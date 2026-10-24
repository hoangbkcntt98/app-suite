import type { AgentMemoryRecord } from '../persistence/worldData';
import type { WorldEvent } from '../simulation/engine';
import { deriveWorldRecords } from '../persistence/worldData';

export type MemoryQuery = {
  agentId: string;
  type?: AgentMemoryRecord['type'];
  taskId?: string;
  relatedAgentId?: string;
  tags?: string[];
  fromTick?: number;
  toTick?: number;
  minImportance?: number;
  limit?: number;
};

export function remember(events: WorldEvent[]): AgentMemoryRecord[] {
  return deriveWorldRecords(events).memories;
}

export function recall(memories: AgentMemoryRecord[], query: MemoryQuery): AgentMemoryRecord[] {
  return memories
    .filter((memory) =>
      memory.agentId === query.agentId
      && (!query.type || memory.type === query.type)
      && (!query.taskId || memory.relatedTaskIds.includes(query.taskId))
      && (!query.relatedAgentId || memory.relatedAgentIds.includes(query.relatedAgentId))
      && (!query.tags?.length || query.tags.every((tag) => memory.tags.includes(tag)))
      && (query.fromTick === undefined || memory.createdAtTick >= query.fromTick)
      && (query.toTick === undefined || memory.createdAtTick <= query.toTick)
      && (query.minImportance === undefined || memory.importance >= query.minImportance),
    )
    .map((memory) => ({
      memory,
      score: (query.taskId && memory.relatedTaskIds.includes(query.taskId) ? 100 : 0)
        + (query.relatedAgentId && memory.relatedAgentIds.includes(query.relatedAgentId) ? 50 : 0)
        + (query.tags?.filter((tag) => memory.tags.includes(tag)).length ?? 0) * 10
        + memory.importance * 2 + memory.createdAtTick / 1_000_000,
    }))
    .sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id))
    .slice(0, Math.max(0, query.limit ?? 50))
    .map(({ memory }) => memory);
}

export function consolidateMemories(memories: AgentMemoryRecord[], retentionLimit = 500): AgentMemoryRecord[] {
  const byAgent = new Map<string, AgentMemoryRecord[]>();
  for (const memory of memories) byAgent.set(memory.agentId, [...(byAgent.get(memory.agentId) ?? []), memory]);
  const result: AgentMemoryRecord[] = [];
  for (const [agentId, records] of [...byAgent.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = records.sort((a, b) => b.importance - a.importance || b.createdAtTick - a.createdAtTick || a.id.localeCompare(b.id));
    if (sorted.length <= retentionLimit) {
      result.push(...sorted);
      continue;
    }
    const retained = sorted.slice(0, Math.max(0, retentionLimit - 1));
    const overflow = sorted.slice(retained.length);
    const sources = [...new Set(overflow.flatMap((record) => record.sourceEventIds))].sort();
    const tasks = [...new Set(overflow.flatMap((record) => record.relatedTaskIds))].sort();
    retained.push({
      id: `memory-consolidated-${agentId}-${sources.join('-')}`,
      agentId,
      type: 'semantic',
      summary: `Consolidated ${overflow.length} lower-priority simulated memories with traceable sources.`,
      sourceEventIds: sources,
      relatedTaskIds: tasks,
      relatedAgentIds: [...new Set(overflow.flatMap((record) => record.relatedAgentIds))].sort(),
      createdAtTick: Math.min(...overflow.map((record) => record.createdAtTick)),
      importance: 2,
      tags: ['consolidated'],
      archived: true,
    });
    result.push(...retained);
  }
  return result;
}

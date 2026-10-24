import { initialSnapshot, type Snapshot, type WorldEvent } from '../simulation/engine';

export const WORLD_SCHEMA_VERSION = 1;
export const WORLD_ID = 'little-agents-village-default';

export type AgentMemoryRecord = {
  id: string;
  agentId: string;
  type: 'episodic' | 'task' | 'social' | 'semantic';
  summary: string;
  sourceEventIds: string[];
  relatedTaskIds: string[];
  relatedAgentIds: string[];
  createdAtTick: number;
  importance: number;
  tags: string[];
  archived: boolean;
};

export type TaskHistoryRecord = {
  taskId: string;
  eventId: string;
  tick: number;
  type: WorldEvent['type'];
  agentId: string | null;
  payload: WorldEvent['payload'];
};

export type AgentRelationship = {
  agentId: string;
  targetAgentId: string;
  collaborationCount: number;
  successfulTasks: number;
  failedTasks: number;
  lastInteractionTick: number;
  lastTaskId?: string;
};

export type PersistedWorld = {
  format: 'little-agents-world';
  schemaVersion: number;
  worldId: string;
  seed: number;
  savedAt: string;
  snapshot: Snapshot;
  memories: AgentMemoryRecord[];
  taskHistory: TaskHistoryRecord[];
  relationships: AgentRelationship[];
  eventSequence: number;
  checkpoints: Snapshot[];
};

const meaningful = new Set<WorldEvent['type']>([
  'task.assigned', 'task.completed', 'task.failed', 'agent.meeting.completed',
  'agent.message.sent', 'agent.work.completed',
]);

export function deriveWorldRecords(events: WorldEvent[]) {
  const memories: AgentMemoryRecord[] = [];
  const taskHistory: TaskHistoryRecord[] = [];
  const pairs = new Map<string, AgentRelationship>();
  const remembered = new Set<string>();
  const taskAgents = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.taskId && event.sourceAgentId && event.type === 'task.assigned') {
      const assigned = taskAgents.get(event.taskId) ?? new Set<string>();
      assigned.add(event.sourceAgentId);
      taskAgents.set(event.taskId, assigned);
    }
  }
  const pairKey = (a: string, b: string) => [a, b].sort().join(':');
  for (const event of events) {
    if (event.taskId && (
      event.type.startsWith('task.')
      || event.type.startsWith('agent.work.')
      || event.type === 'agent.meeting.completed'
    )) {
      taskHistory.push({
        taskId: event.taskId, eventId: event.id, tick: event.tick,
        type: event.type, agentId: event.sourceAgentId, payload: event.payload,
      });
    }
    if (!meaningful.has(event.type) || remembered.has(event.id)) continue;
    remembered.add(event.id);
    const meetingParticipants = event.type === 'agent.meeting.completed' && Array.isArray(event.payload.participants)
      ? event.payload.participants : [];
    const recipients = event.type === 'task.completed' || event.type === 'task.failed'
      ? [...(event.taskId ? taskAgents.get(event.taskId) ?? [] : [])]
      : meetingParticipants.length
        ? [event.sourceAgentId, ...meetingParticipants].filter((id): id is string => typeof id === 'string')
      : event.targetAgentId && event.sourceAgentId
      ? [event.sourceAgentId, event.targetAgentId] : event.sourceAgentId ? [event.sourceAgentId] : [];
    const related = event.type === 'agent.meeting.completed'
      ? meetingParticipants.filter((id): id is string => typeof id === 'string' && id !== event.sourceAgentId)
      : event.sourceAgentId && event.targetAgentId ? [event.targetAgentId] : [];
    for (const agentId of recipients) {
      const summary = event.type === 'agent.message.sent'
        ? `${event.sourceAgentId} shared a simulated message${event.targetAgentId ? ` with ${event.targetAgentId}` : ''}.`
        : `${event.type.replaceAll('.', ' ')}${event.taskId ? ` for ${event.taskId}` : ''}.`;
      memories.push({
        id: `memory-${event.id}-${agentId}`, agentId,
        type: event.type === 'agent.meeting.completed' || event.type === 'agent.message.sent'
          ? 'social'
          : event.type === 'task.assigned' || event.type.startsWith('task.') || event.type === 'agent.work.completed' ? 'task' : 'episodic',
        summary, sourceEventIds: [event.id], relatedTaskIds: event.taskId ? [event.taskId] : [],
        relatedAgentIds: related.filter((id) => id !== agentId), createdAtTick: event.tick,
        importance: event.type === 'task.completed' || event.type === 'task.failed' ? 5 : 3,
        tags: [event.type.split('.')[0], event.type.split('.').at(-1) ?? 'event'], archived: false,
      });
    }
    if (event.type === 'agent.meeting.completed' && event.sourceAgentId) {
      const participants = event.payload.participants;
      const targets = Array.isArray(participants) ? participants : [];
      for (const target of targets) {
        if (target === event.sourceAgentId) continue;
        const key = pairKey(event.sourceAgentId, target);
        const current = pairs.get(key) ?? {
          agentId: event.sourceAgentId, targetAgentId: target,
          collaborationCount: 0, successfulTasks: 0, failedTasks: 0, lastInteractionTick: event.tick,
        };
        current.collaborationCount += 1;
        current.lastInteractionTick = event.tick;
        if (event.taskId) current.lastTaskId = event.taskId;
        pairs.set(key, current);
      }
    }
  }
  for (const event of events) {
    if (!event.taskId || (event.type !== 'task.completed' && event.type !== 'task.failed')) continue;
    const participants = [...(taskAgents.get(event.taskId) ?? [])].sort();
    for (let left = 0; left < participants.length; left += 1) {
      for (let right = left + 1; right < participants.length; right += 1) {
        const key = pairKey(participants[left], participants[right]);
        const current = pairs.get(key) ?? {
          agentId: participants[left], targetAgentId: participants[right],
          collaborationCount: 0, successfulTasks: 0, failedTasks: 0, lastInteractionTick: event.tick,
        };
        if (event.type === 'task.completed') current.successfulTasks += 1;
        else current.failedTasks += 1;
        current.lastTaskId = event.taskId;
        current.lastInteractionTick = event.tick;
        pairs.set(key, current);
      }
    }
  }
  return { memories, taskHistory, relationships: [...pairs.values()] };
}

export function validateWorld(value: unknown): value is PersistedWorld {
  if (!value || typeof value !== 'object') return false;
  const world = value as Partial<PersistedWorld>;
  if (!(world.format === 'little-agents-world'
    && world.schemaVersion === WORLD_SCHEMA_VERSION
    && typeof world.worldId === 'string'
    && Number.isInteger(world.seed)
    && !!world.snapshot && typeof world.snapshot === 'object'
    && Number.isInteger(world.snapshot.tick) && world.snapshot.tick >= 0
    && Array.isArray(world.snapshot.agents) && Array.isArray(world.snapshot.events)
    && Array.isArray(world.memories) && Array.isArray(world.taskHistory)
    && Array.isArray(world.relationships) && Array.isArray(world.checkpoints)
    && world.eventSequence === world.snapshot.events.length
    && world.snapshot.events.every((event) => event && typeof event.id === 'string' && Number.isInteger(event.tick) && event.tick >= 0))) return false;
  const eventIds = new Set(world.snapshot.events.map((event) => event.id));
  if (eventIds.size !== world.snapshot.events.length) return false;
  if (world.snapshot.events.some((event, index, list) => index > 0 && event.tick < list[index - 1].tick)) return false;
  if (world.memories.some((memory) => !memory || typeof memory.id !== 'string'
    || typeof memory.agentId !== 'string' || !Array.isArray(memory.sourceEventIds)
    || !memory.sourceEventIds.length || memory.sourceEventIds.some((id) => !eventIds.has(id))
    || !Array.isArray(memory.relatedTaskIds) || !Array.isArray(memory.relatedAgentIds)
    || !Number.isInteger(memory.createdAtTick) || !Number.isFinite(memory.importance))) return false;
  if (world.taskHistory.some((record) => !record || !eventIds.has(record.eventId) || !Number.isInteger(record.tick))) return false;
  if (world.relationships.some((relationship) => !relationship
    || typeof relationship.agentId !== 'string' || typeof relationship.targetAgentId !== 'string'
    || !Number.isInteger(relationship.collaborationCount) || !Number.isInteger(relationship.successfulTasks)
    || !Number.isInteger(relationship.failedTasks) || !Number.isInteger(relationship.lastInteractionTick))) return false;
  return world.checkpoints.every((checkpoint) => checkpoint && Number.isInteger(checkpoint.tick)
    && checkpoint.tick >= 0 && Array.isArray(checkpoint.agents) && Array.isArray(checkpoint.events));
}

export function migrateWorld(value: unknown): PersistedWorld {
  if (!value || typeof value !== 'object') throw new Error('World data must be an object.');
  const source = value as Partial<PersistedWorld>;
  if (source.format !== 'little-agents-world' || !source.snapshot || typeof source.snapshot !== 'object') {
    throw new Error('Unsupported world format.');
  }
  if (source.schemaVersion === WORLD_SCHEMA_VERSION && validateWorld(value)) return value;
  if (source.schemaVersion !== 0 || !Array.isArray(source.snapshot.events)) {
    throw new Error(`Unsupported world schema version: ${String(source.schemaVersion)}.`);
  }
  const records = deriveWorldRecords(source.snapshot.events);
  const migrated: PersistedWorld = {
    format: 'little-agents-world',
    schemaVersion: WORLD_SCHEMA_VERSION,
    worldId: typeof source.worldId === 'string' ? source.worldId : WORLD_ID,
    seed: Number.isInteger(source.seed) ? source.seed! : 1,
    savedAt: typeof source.savedAt === 'string' ? source.savedAt : new Date(0).toISOString(),
    snapshot: { ...source.snapshot, running: false },
    ...records,
    eventSequence: source.snapshot.events.length,
    checkpoints: Array.isArray(source.checkpoints) ? source.checkpoints : [{ ...source.snapshot, running: false }],
  };
  if (!validateWorld(migrated)) throw new Error('World migration failed validation.');
  return migrated;
}

export function createPersistedWorld(snapshot: Snapshot, checkpoints: Snapshot[] = []): PersistedWorld {
  const records = deriveWorldRecords(snapshot.events);
  const initial = initialSnapshot(snapshot.scenario);
  const allCheckpoints = [initial, ...checkpoints]
    .filter((checkpoint, index, list) => list.findIndex((candidate) => candidate.tick === checkpoint.tick) === index)
    .sort((a, b) => a.tick - b.tick);
  return {
    format: 'little-agents-world', schemaVersion: WORLD_SCHEMA_VERSION, worldId: WORLD_ID,
    seed: 1,
    savedAt: new Date().toISOString(), snapshot: { ...snapshot, running: false },
    ...records, eventSequence: snapshot.events.length,
    checkpoints: allCheckpoints,
  };
}

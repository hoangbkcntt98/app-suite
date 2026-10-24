import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, initialSnapshot, scenarioPhaseCount, start, type ScenarioId } from './engine';
import { findPath, isWalkable } from './navigation';
import { useWorld } from '../store/world';
import { createPersistedWorld, deriveWorldRecords, migrateWorld, validateWorld } from '../persistence/worldData';
import { consolidateMemories, recall } from '../memory/MemoryService';
import { seekReplay } from '../replay/ReplayEngine';

function runScenario(scenario: ScenarioId) {
  let snapshot = start(initialSnapshot(scenario));
  for (let tick = 0; tick < 5000 && snapshot.running; tick += 1) snapshot = advance(snapshot);
  return snapshot;
}

test('A* routes around house and desk obstacles with deterministic path steps', () => {
  const path = findPath({ x: -5, z: -4 }, { x: 0, z: 0 });
  assert.ok(path);
  assert.ok(path.length > 10);
  assert.ok(path.every(isWalkable));
  for (let index = 1; index < path.length; index += 1) {
    assert.equal(Math.hypot(path[index].x - path[index - 1].x, path[index].z - path[index - 1].z), 0.5);
  }
  assert.equal(findPath({ x: 100, z: 100 }, { x: 0, z: 0 }), null);
});

test('each scenario reaches completion with stable event logs', () => {
  for (const scenario of ['success', 'qa-rework', 'parallel'] as const) {
    const first = runScenario(scenario);
    const second = runScenario(scenario);
    assert.equal(first.running, false);
    assert.equal(first.phaseIndex, scenarioPhaseCount[scenario] - 1);
    assert.deepEqual(first, second);
    assert.ok(first.events.some((event) => event.type === 'task.completed' && event.payload.simulated === true));
  }
});

test('QA rework scenario emits simulated failure, rework, and retest events', () => {
  const result = runScenario('qa-rework');
  const failures = result.events.filter((event) => event.type === 'task.failed');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].payload.simulated, true);
  assert.ok(result.events.some((event) => event.type === 'agent.meeting.completed'));
  assert.equal(result.events.filter((event) => event.type === 'agent.work.completed').length, 4);
});

test('parallel scenario starts Foxy and Luna work during same phase', () => {
  let snapshot = start(initialSnapshot('parallel'));
  for (let tick = 0; tick < 2; tick += 1) snapshot = advance(snapshot);
  const fox = snapshot.agents.find((agent) => agent.id === 'foxy')!;
  const luna = snapshot.agents.find((agent) => agent.id === 'luna')!;
  assert.ok(fox.currentAction || fox.actionQueue.length);
  assert.ok(luna.currentAction || luna.actionQueue.length);
  assert.equal(snapshot.phaseTitle, 'Parallel discovery');
});

test('meeting and work actions preserve queue order and emit movement events', () => {
  let snapshot = start(initialSnapshot('success'));
  for (let tick = 0; tick < 500 && snapshot.agents.find((agent) => agent.id === 'mochi')?.currentAction?.type !== 'meet'; tick += 1) {
    snapshot = advance(snapshot);
  }
  const mochi = snapshot.agents.find((agent) => agent.id === 'mochi')!;
  assert.equal(mochi.currentAction?.type, 'meet');
  const moveDone = snapshot.events.findIndex((event) =>
    event.type === 'agent.action.completed' && event.sourceAgentId === 'mochi' && event.payload.action === 'move_to',
  );
  const meetStarted = snapshot.events.findIndex((event) =>
    event.type === 'agent.action.started' && event.sourceAgentId === 'mochi' && event.payload.action === 'meet',
  );
  assert.ok(moveDone >= 0 && meetStarted > moveDone);
  assert.ok(snapshot.events.some((event) => event.type === 'agent.movement.completed' && event.sourceAgentId === 'mochi'));
});

test('paused snapshots do not advance; resume continues fixed-step state', () => {
  const snapshot = start(initialSnapshot());
  const paused = { ...advance(snapshot), running: false };
  assert.equal(advance(paused), paused);
  assert.equal(advance({ ...paused, running: true }).tick, paused.tick + 1);
});

test('store reset clears actions and starts chosen scenario from tick zero', () => {
  useWorld.getState().chooseScenario('qa-rework');
  useWorld.getState().start();
  useWorld.getState().step();
  useWorld.getState().reset();
  const reset = useWorld.getState().snapshot;
  assert.equal(reset.scenario, 'qa-rework');
  assert.equal(reset.tick, 0);
  assert.equal(reset.running, false);
  assert.deepEqual(reset.events, []);
  assert.ok(reset.agents.every((agent) => agent.currentAction === null && agent.actionQueue.length === 0));
});

test('300-tick persisted checkpoint resumes to same state as uninterrupted simulation', () => {
  let uninterrupted = start(initialSnapshot('success'));
  let firstHalf = uninterrupted;
  for (let tick = 0; tick < 300; tick += 1) {
    uninterrupted = advance(uninterrupted);
    firstHalf = advance(firstHalf);
  }
  const saved = createPersistedWorld(firstHalf);
  assert.equal(saved.snapshot.running, false);
  let restored = { ...saved.snapshot, running: true };
  for (let tick = 0; tick < 300; tick += 1) {
    uninterrupted = advance(uninterrupted);
    restored = advance(restored);
  }
  assert.deepEqual(restored, uninterrupted);
});

test('memory extraction is event-idempotent, traceable, and world validation rejects tampering', () => {
  const snapshot = runScenario('success');
  const duplicatedEvents = [...snapshot.events, ...snapshot.events];
  const once = deriveWorldRecords(snapshot.events);
  const repeated = deriveWorldRecords(duplicatedEvents);
  assert.deepEqual(repeated.memories, once.memories);
  assert.ok(once.memories.every((memory) => memory.sourceEventIds.length > 0));
  assert.ok(once.taskHistory.length > 0);
  assert.equal(validateWorld(createPersistedWorld(snapshot)), true);
  assert.equal(validateWorld({ ...createPersistedWorld(snapshot), eventSequence: -1 }), false);
});

test('replay seeking from checkpoint matches deterministic live simulation without running it', () => {
  let snapshot = start(initialSnapshot('parallel'));
  let checkpoint = snapshot;
  for (let tick = 0; tick < 600; tick += 1) {
    snapshot = advance(snapshot);
    if (snapshot.tick === 300) checkpoint = snapshot;
  }
  const replay = seekReplay([initialSnapshot('parallel'), checkpoint], 600);
  assert.deepEqual(replay, { ...snapshot, running: false });
  assert.equal(snapshot.running, true);
});

test('memory retrieval ranks task matches and consolidation preserves source references', () => {
  const records = deriveWorldRecords(runScenario('success').events).memories;
  const agentId = records[0].agentId;
  const match = records.find((memory) => memory.agentId === agentId && memory.relatedTaskIds.length > 0)!;
  const recalled = recall(records, { agentId, taskId: match.relatedTaskIds[0], limit: 1 })[0];
  assert.ok(recalled.relatedTaskIds.includes(match.relatedTaskIds[0]));
  const compact = consolidateMemories(records, 3);
  assert.ok(compact.length <= 3 * new Set(records.map((memory) => memory.agentId)).size);
  assert.ok(compact.every((memory) => memory.sourceEventIds.length > 0));
});

test('schema zero world migrates to current version and collaborations derive from events', () => {
  const snapshot = runScenario('success');
  const world = createPersistedWorld(snapshot);
  const migrated = migrateWorld({ ...world, schemaVersion: 0 });
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(validateWorld(migrated), true);
  assert.ok(migrated.relationships.some((relationship) => relationship.collaborationCount > 0));
  assert.ok(migrated.relationships.some((relationship) => relationship.successfulTasks > 0));
});

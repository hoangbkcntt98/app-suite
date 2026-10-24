import { agents, type Status, type Vec2 } from '../data/agents';
import { findPath } from './navigation';

export type ScenarioId = 'success' | 'qa-rework' | 'parallel';
export type Behavior = 'idle' | 'planning' | 'navigating' | 'waiting' | 'working' | 'thinking' | 'communicating' | 'collaborating' | 'celebrating' | 'error';
export type Tone = 'thinking' | 'speaking' | 'success' | 'error';

export type AgentAction =
  | { type: 'move_to'; destinationId: string }
  | { type: 'work'; taskId: string; activity: string; durationTicks: number; result?: 'pass' | 'fail'; message: string }
  | { type: 'think'; durationTicks: number }
  | { type: 'meet'; locationId: string; withAgentIds: string[]; durationTicks: number; message: string }
  | { type: 'speak'; message: string; targetAgentId?: string; durationTicks: number }
  | { type: 'wait'; durationTicks: number }
  | { type: 'celebrate'; durationTicks: number };

export type Speech = { text: string; tone: Tone; untilTick: number; eventId: string };
export type AgentState = {
  id: string;
  position: Vec2;
  destination: Vec2;
  destinationId: string | null;
  path: Vec2[];
  status: Status;
  behavior: Behavior;
  activity: string;
  taskId: string | null;
  actionQueue: AgentAction[];
  currentAction: AgentAction | null;
  actionElapsed: number;
  interactionTarget: string | null;
  recentEventIds: string[];
  speech: Speech | null;
};
export type WorldEventType =
  | 'task.created' | 'task.assigned' | 'task.started' | 'task.completed' | 'task.failed'
  | 'agent.action.started' | 'agent.action.completed'
  | 'agent.movement.started' | 'agent.movement.completed'
  | 'scenario.phase.started'
  | 'agent.meeting.requested' | 'agent.meeting.started' | 'agent.meeting.completed'
  | 'agent.message.sent' | 'agent.message.received'
  | 'agent.work.started' | 'agent.work.completed' | 'agent.error';
export type WorldEvent = {
  id: string;
  tick: number;
  type: WorldEventType;
  sourceAgentId: string | null;
  targetAgentId?: string;
  taskId?: string;
  payload: Record<string, string | number | boolean | string[]>;
};
export type CommunicationLink = { id: string; sourceAgentId: string; targetAgentId: string; untilTick: number };
export type Snapshot = {
  tick: number;
  running: boolean;
  speed: 1 | 2 | 4;
  scenario: ScenarioId;
  phaseIndex: number;
  phaseTitle: string;
  phasePending: string[];
  taskTitle: string;
  taskId: string;
  agents: AgentState[];
  events: WorldEvent[];
  connections: CommunicationLink[];
};

type WorkPhase = { kind: 'work'; title: string; jobs: { agentId: string; activity: string; durationTicks: number; result?: 'pass' | 'fail'; message: string }[] };
type MeetingPhase = { kind: 'meeting'; title: string; agentIds: string[]; durationTicks: number; message: string };
type Phase = WorkPhase | MeetingPhase;
export const TICK_RATE = 30;

export const scenarioLabels: Record<ScenarioId, string> = {
  success: 'A · Successful task',
  'qa-rework': 'B · QA failure & rework',
  parallel: 'C · Parallel collaboration',
};

const scenarioPhases: Record<ScenarioId, Phase[]> = {
  success: [
    { kind: 'meeting', title: 'Planning sync', agentIds: ['mochi', 'luna', 'foxy'], durationTicks: 42, message: "Let's plan this task together!" },
    { kind: 'work', title: 'Product plan', jobs: [{ agentId: 'luna', activity: 'Planning interface and task scope', durationTicks: 72, message: 'Plan is ready for research.' }] },
    { kind: 'work', title: 'Research', jobs: [{ agentId: 'foxy', activity: 'Researching references', durationTicks: 90, message: 'Research notes are ready.' }] },
    { kind: 'meeting', title: 'Research handoff', agentIds: ['foxy', 'pip'], durationTicks: 36, message: 'Here are the research findings.' },
    { kind: 'work', title: 'Implementation', jobs: [{ agentId: 'pip', activity: 'Building the interface', durationTicks: 120, message: 'Implementation is ready for QA.' }] },
    { kind: 'work', title: 'Quality checks', jobs: [{ agentId: 'bobo', activity: 'Running simulated tests', durationTicks: 72, result: 'pass', message: 'All simulated tests passed.' }] },
    { kind: 'work', title: 'Code review', jobs: [{ agentId: 'ollie', activity: 'Reviewing implementation', durationTicks: 60, message: 'Review approved.' }] },
  ],
  'qa-rework': [
    { kind: 'work', title: 'Implementation', jobs: [{ agentId: 'pip', activity: 'Building the interface', durationTicks: 96, message: 'First implementation ready for QA.' }] },
    { kind: 'work', title: 'QA · first pass', jobs: [{ agentId: 'bobo', activity: 'Running simulated tests', durationTicks: 48, result: 'fail', message: 'A simulated test failed. Rework needed.' }] },
    { kind: 'meeting', title: 'Bug report', agentIds: ['bobo', 'pip'], durationTicks: 42, message: 'I found an issue. Please check the latest change.' },
    { kind: 'work', title: 'Rework', jobs: [{ agentId: 'pip', activity: 'Fixing reported issue', durationTicks: 72, message: 'Fix is ready for retest.' }] },
    { kind: 'work', title: 'QA · retest', jobs: [{ agentId: 'bobo', activity: 'Retesting the fix', durationTicks: 48, result: 'pass', message: 'Retest passed.' }] },
    { kind: 'work', title: 'Code review', jobs: [{ agentId: 'ollie', activity: 'Reviewing the verified fix', durationTicks: 60, message: 'Review approved.' }] },
  ],
  parallel: [
    { kind: 'work', title: 'Parallel discovery', jobs: [
      { agentId: 'foxy', activity: 'Researching references', durationTicks: 90, message: 'Research notes are ready.' },
      { agentId: 'luna', activity: 'Planning product requirements', durationTicks: 72, message: 'Product plan is ready.' },
    ] },
    { kind: 'meeting', title: 'Dependency handoff', agentIds: ['foxy', 'luna', 'pip'], durationTicks: 36, message: 'Research and plan are aligned. Pip can begin.' },
    { kind: 'work', title: 'Implementation', jobs: [{ agentId: 'pip', activity: 'Building from approved requirements', durationTicks: 120, message: 'Implementation is ready for QA.' }] },
    { kind: 'work', title: 'Quality checks', jobs: [{ agentId: 'bobo', activity: 'Running simulated tests', durationTicks: 72, result: 'pass', message: 'All simulated tests passed.' }] },
    { kind: 'work', title: 'Code review', jobs: [{ agentId: 'ollie', activity: 'Reviewing implementation', durationTicks: 60, message: 'Review approved.' }] },
  ],
};
export const scenarioPhaseCount: Record<ScenarioId, number> = {
  success: scenarioPhases.success.length,
  'qa-rework': scenarioPhases['qa-rework'].length,
  parallel: scenarioPhases.parallel.length,
};

const taskTitles: Record<ScenarioId, string> = {
  success: 'Build a cozy landing page',
  'qa-rework': 'Build and verify a cozy landing page',
  parallel: 'Research and plan a cozy landing page',
};

const meetingSlot: Record<string, Vec2> = {
  mochi: { x: -0.75, z: -0.6 }, luna: { x: 0.75, z: -0.6 }, foxy: { x: -0.75, z: 0.6 },
  pip: { x: 0.75, z: 0.6 }, bobo: { x: -1.15, z: 1.25 }, ollie: { x: 1.15, z: 1.25 },
};

function resolveDestination(id: string): Vec2 | null {
  if (id.startsWith('work:')) {
    const agent = agents.find((item) => item.id === id.slice(5));
    return agent?.work ?? null;
  }
  if (id.startsWith('home:')) {
    const agent = agents.find((item) => item.id === id.slice(5));
    return agent?.home ?? null;
  }
  if (id.startsWith('meeting:')) return meetingSlot[id.slice(8)] ?? null;
  if (id === 'village-square') return { x: 0, z: 0 };
  if (id === 'meeting-area') return { x: 0, z: 0 };
  return null;
}

export function initialSnapshot(scenario: ScenarioId = 'success'): Snapshot {
  return {
    tick: 0, running: false, speed: 1, scenario, phaseIndex: -1, phaseTitle: 'Ready',
    phasePending: [], taskTitle: taskTitles[scenario], taskId: `task-${scenario}`,
    agents: agents.map((agent) => ({
      id: agent.id, position: { ...agent.home }, destination: { ...agent.home }, destinationId: null,
      path: [], status: 'idle', behavior: 'idle', activity: 'Resting at home', taskId: null,
      actionQueue: [], currentAction: null, actionElapsed: 0, interactionTarget: null,
      recentEventIds: [], speech: null,
    })),
    events: [], connections: [],
  };
}

function emit(snapshot: Snapshot, type: WorldEventType, sourceAgentId: string | null, payload: WorldEvent['payload'] = {}, targetAgentId?: string) {
  const id = `evt-${snapshot.tick}-${snapshot.events.length + 1}`;
  const event: WorldEvent = { id, tick: snapshot.tick, type, sourceAgentId, targetAgentId, taskId: snapshot.taskId, payload };
  snapshot.events.push(event);
  if (sourceAgentId) {
    const source = snapshot.agents.find((agent) => agent.id === sourceAgentId);
    if (source) source.recentEventIds = [...source.recentEventIds, id].slice(-8);
  }
  return event;
}

function say(snapshot: Snapshot, agent: AgentState, message: string, tone: Tone, targetAgentId?: string) {
  const event = emit(snapshot, 'agent.message.sent', agent.id, { message, tone }, targetAgentId);
  agent.speech = { text: message, tone, untilTick: snapshot.tick + 105, eventId: event.id };
  if (targetAgentId) emit(snapshot, 'agent.message.received', targetAgentId, { message, tone }, agent.id);
}

function actionsForPhase(snapshot: Snapshot, phase: Phase) {
  snapshot.phaseTitle = phase.title;
  snapshot.phasePending = phase.kind === 'meeting' ? [...phase.agentIds] : phase.jobs.map((job) => job.agentId);
  emit(snapshot, 'scenario.phase.started', null, { phase: phase.title, simulated: true });
  if (phase.kind === 'meeting') {
    for (const id of phase.agentIds) {
      const agent = snapshot.agents.find((item) => item.id === id)!;
      const others = phase.agentIds.filter((other) => other !== id);
      agent.taskId = snapshot.taskId;
      agent.actionQueue = [
        ...(id === 'mochi' && phase.title === 'Planning sync' ? [{ type: 'think' as const, durationTicks: 24 }] : []),
        { type: 'move_to', destinationId: `meeting:${id}` },
        { type: 'meet', locationId: 'meeting-area', withAgentIds: others, durationTicks: phase.durationTicks, message: phase.message },
        { type: 'move_to', destinationId: `work:${id}` },
      ];
      emit(snapshot, 'agent.meeting.requested', id, { participants: phase.agentIds, locationId: 'meeting-area' });
      emit(snapshot, 'task.assigned', id, { phase: phase.title });
    }
  } else {
    for (const job of phase.jobs) {
      const agent = snapshot.agents.find((item) => item.id === job.agentId)!;
      agent.taskId = snapshot.taskId;
      agent.actionQueue = [
        { type: 'move_to', destinationId: `work:${job.agentId}` },
        { type: 'work', taskId: snapshot.taskId, activity: job.activity, durationTicks: job.durationTicks, result: job.result, message: job.message },
      ];
      emit(snapshot, 'task.assigned', job.agentId, { phase: phase.title, activity: job.activity });
    }
  }
}

function beginAction(snapshot: Snapshot, agent: AgentState) {
  if (agent.currentAction || !agent.actionQueue.length) return;
  agent.currentAction = agent.actionQueue.shift()!;
  agent.actionElapsed = 0;
  const action = agent.currentAction;
  emit(snapshot, 'agent.action.started', agent.id, { action: action.type });
  if (action.type === 'move_to') {
    const destination = resolveDestination(action.destinationId);
    if (!destination) {
      agent.behavior = 'error';
      agent.status = 'error';
      agent.activity = `Unknown destination: ${action.destinationId}`;
      emit(snapshot, 'agent.error', agent.id, { reason: agent.activity });
      agent.currentAction = null;
      agent.actionQueue = [];
      return;
    }
    const path = findPath(agent.position, destination);
    if (!path) {
      agent.behavior = 'error';
      agent.status = 'error';
      agent.activity = 'Destination unreachable';
      emit(snapshot, 'agent.error', agent.id, { reason: agent.activity, destinationId: action.destinationId });
      agent.currentAction = null;
      agent.actionQueue = [];
      return;
    }
    agent.destination = path.length ? path[path.length - 1] : { ...agent.position };
    agent.destinationId = action.destinationId;
    agent.path = path;
    agent.behavior = 'navigating';
    agent.status = path.length ? 'walking' : 'idle';
    agent.activity = path.length ? `Walking to ${action.destinationId}` : 'Arrived';
    emit(snapshot, 'agent.movement.started', agent.id, { destinationId: action.destinationId });
  } else if (action.type === 'work') {
    agent.behavior = 'working';
    agent.status = 'working';
    agent.activity = action.activity;
    emit(snapshot, 'agent.work.started', agent.id, { activity: action.activity });
  } else if (action.type === 'think') {
    agent.behavior = 'thinking'; agent.status = 'thinking'; agent.activity = 'Thinking';
  } else if (action.type === 'meet') {
    agent.behavior = 'communicating'; agent.status = 'working'; agent.activity = 'Sharing information';
    agent.interactionTarget = action.withAgentIds[0] ?? null;
    emit(snapshot, 'agent.meeting.started', agent.id, { locationId: action.locationId, participants: action.withAgentIds });
    say(snapshot, agent, action.message, 'speaking', agent.interactionTarget ?? undefined);
    action.withAgentIds.forEach((targetAgentId) => {
      snapshot.connections.push({
        id: `link-${snapshot.tick}-${agent.id}-${targetAgentId}`,
        sourceAgentId: agent.id,
        targetAgentId,
        untilTick: snapshot.tick + action.durationTicks,
      });
    });
  } else if (action.type === 'speak') {
    agent.behavior = 'communicating'; agent.status = 'working'; agent.activity = 'Communicating';
    agent.interactionTarget = action.targetAgentId ?? null;
    say(snapshot, agent, action.message, 'speaking', action.targetAgentId);
  } else if (action.type === 'wait') {
    agent.behavior = 'waiting'; agent.status = 'idle'; agent.activity = 'Waiting for teammates';
  } else if (action.type === 'celebrate') {
    agent.behavior = 'celebrating'; agent.status = 'success'; agent.activity = 'Celebrating simulated completion';
  }
}

function completeAction(snapshot: Snapshot, agent: AgentState) {
  const action = agent.currentAction;
  if (!action) return;
  emit(snapshot, 'agent.action.completed', agent.id, { action: action.type });
  if (action.type === 'move_to') {
    agent.path = [];
    agent.behavior = 'idle';
    agent.status = 'idle';
    agent.activity = 'Arrived';
    emit(snapshot, 'agent.movement.completed', agent.id, { destinationId: action.destinationId });
  } else if (action.type === 'work') {
    const failed = action.result === 'fail';
    agent.behavior = failed ? 'error' : 'idle';
    agent.status = failed ? 'error' : 'success';
    agent.activity = failed ? 'Simulated test failure' : 'Work complete';
    emit(snapshot, failed ? 'task.failed' : 'agent.work.completed', agent.id, { activity: action.activity, simulated: true, result: action.result ?? 'complete' });
    say(snapshot, agent, action.message, failed ? 'error' : 'success');
  } else if (action.type === 'meet') {
    agent.behavior = 'collaborating';
    agent.status = 'working';
    agent.activity = 'Meeting complete';
    emit(snapshot, 'agent.meeting.completed', agent.id, { locationId: action.locationId, participants: action.withAgentIds });
  } else if (action.type === 'speak') {
    agent.behavior = 'idle'; agent.status = 'idle'; agent.activity = 'Message sent';
  } else if (action.type === 'celebrate') {
    agent.behavior = 'idle'; agent.status = 'success'; agent.activity = 'Task complete';
  } else {
    agent.behavior = 'idle'; agent.status = 'idle'; agent.activity = 'Resting';
  }
  agent.currentAction = null;
  agent.actionElapsed = 0;
  agent.interactionTarget = null;
}

function tickAgent(snapshot: Snapshot, agent: AgentState) {
  beginAction(snapshot, agent);
  const action = agent.currentAction;
  if (!action) return;
  if (action.type === 'move_to') {
    const next = agent.path[0];
    if (!next) {
      completeAction(snapshot, agent);
      beginAction(snapshot, agent);
      return;
    }
    const dx = next.x - agent.position.x;
    const dz = next.z - agent.position.z;
    const distance = Math.hypot(dx, dz);
    const step = 2.4 / TICK_RATE;
    if (distance <= step) {
      agent.position = { ...next };
      agent.path.shift();
    } else {
      agent.position = { x: agent.position.x + (dx / distance) * step, z: agent.position.z + (dz / distance) * step };
    }
    if (!agent.path.length) {
      completeAction(snapshot, agent);
      beginAction(snapshot, agent);
    }
    return;
  }
  agent.actionElapsed += 1;
  if (agent.actionElapsed < action.durationTicks) return;
  completeAction(snapshot, agent);
  beginAction(snapshot, agent);
}

function progressScenario(snapshot: Snapshot) {
  snapshot.phasePending = snapshot.phasePending.filter((agentId) => {
    const agent = snapshot.agents.find((item) => item.id === agentId)!;
    return agent.currentAction !== null || agent.actionQueue.length > 0;
  });
  if (snapshot.phasePending.length) return;
  const nextIndex = snapshot.phaseIndex + 1;
  const phases = scenarioPhases[snapshot.scenario];
  if (nextIndex >= phases.length) {
    snapshot.running = false;
    snapshot.phaseTitle = 'Completed · simulated';
    snapshot.agents.forEach((agent) => {
      agent.taskId = null;
      agent.behavior = 'celebrating';
      agent.status = 'success';
      agent.activity = 'Simulated task complete';
      agent.actionQueue = [];
    });
    emit(snapshot, 'task.completed', null, { title: snapshot.taskTitle, simulated: true });
    return;
  }
  snapshot.phaseIndex = nextIndex;
  actionsForPhase(snapshot, phases[nextIndex]);
}

export function start(snapshot: Snapshot): Snapshot {
  if (snapshot.phaseTitle.startsWith('Completed')) return snapshot;
  return { ...snapshot, running: true };
}

export function setScenario(scenario: ScenarioId): Snapshot {
  return initialSnapshot(scenario);
}

export function setSpeed(snapshot: Snapshot, speed: Snapshot['speed']): Snapshot {
  return { ...snapshot, speed };
}

export function advance(previous: Snapshot): Snapshot {
  if (!previous.running) return previous;
  const snapshot: Snapshot = {
    ...previous,
    tick: previous.tick + 1,
    agents: previous.agents.map((agent) => ({
      ...agent,
      position: { ...agent.position },
      destination: { ...agent.destination },
      path: agent.path.map((point) => ({ ...point })),
      actionQueue: [...agent.actionQueue],
      currentAction: agent.currentAction ? { ...agent.currentAction } : null,
      recentEventIds: [...agent.recentEventIds],
      speech: agent.speech && agent.speech.untilTick > previous.tick + 1 ? { ...agent.speech } : null,
    })),
    events: [...previous.events],
    connections: previous.connections.filter((link) => link.untilTick > previous.tick + 1),
    phasePending: [...previous.phasePending],
  };
  if (snapshot.phaseIndex === -1) {
    emit(snapshot, 'task.created', null, { title: snapshot.taskTitle, simulated: true });
    emit(snapshot, 'task.started', null, { title: snapshot.taskTitle, simulated: true });
    snapshot.phaseIndex = 0;
    actionsForPhase(snapshot, scenarioPhases[snapshot.scenario][0]);
  }
  snapshot.agents.forEach((agent) => tickAgent(snapshot, agent));
  progressScenario(snapshot);
  return snapshot;
}

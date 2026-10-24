'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { agents } from '../data/agents';
import { scenarioLabels, scenarioPhaseCount, type Behavior, type ScenarioId } from '../simulation/engine';
import { useWorld } from '../store/world';
import { Village } from '../world/Village';
import { deleteWorld, loadWorld, replaceWorld, saveWorld } from '../persistence/database';
import { deriveWorldRecords, migrateWorld } from '../persistence/worldData';
import { initialSnapshot, type Snapshot } from '../simulation/engine';
import { seekReplay } from '../replay/ReplayEngine';
import { consolidateMemories, recall } from '../memory/MemoryService';
import type { LiveEvent } from '../server/contracts';

const behaviorLabels: Record<Behavior, string> = {
  idle: 'Idle', planning: 'Planning', navigating: 'Walking', waiting: 'Waiting',
  working: 'Working', thinking: 'Thinking', communicating: 'Communicating',
  collaborating: 'Collaborating', celebrating: 'Celebrating', error: 'Needs help',
};
const statusLabels = {
  idle: 'Idle', walking: 'Walking', working: 'Working', thinking: 'Thinking', success: 'Success', error: 'Error',
};
const locationName = (id: string | null) => {
  if (!id) return '—';
  if (id.startsWith('work:')) return `${agents.find((agent) => agent.id === id.slice(5))?.name ?? 'Agent'} workstation`;
  if (id.startsWith('home:')) return `${agents.find((agent) => agent.id === id.slice(5))?.name ?? 'Agent'} home`;
  if (id.startsWith('meeting:')) return 'Meeting area';
  return id.replaceAll('-', ' ');
};
const clock = (tick: number) => {
  const seconds = Math.floor(tick / 30);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export function Dashboard() {
  const [mode, setMode] = useState<'simulation' | 'live'>('simulation');
  const [liveTask, setLiveTask] = useState('');
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [liveStatuses, setLiveStatuses] = useState<Record<string, string>>({});
  const [liveMessage, setLiveMessage] = useState('');
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveRuns, setLiveRuns] = useState<Array<{ runId: string; task: string; status: string; provider: string; model: string; inputTokens: number; outputTokens: number }>>([]);
  const [selectedRunEvents, setSelectedRunEvents] = useState<LiveEvent[]>([]);
  const liveController = useRef<AbortController | null>(null);
  const [worldMessage, setWorldMessage] = useState('Checking saved world…');
  const [checkpointCount, setCheckpointCount] = useState(0);
  const [replaySnapshot, setReplaySnapshot] = useState<Snapshot | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const checkpoints = useRef<import('../simulation/engine').Snapshot[]>([]);
  const latestTick = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const snap = useWorld((state) => state.snapshot);
  const selected = useWorld((state) => state.selected);
  const select = useWorld((state) => state.select);
  const start = useWorld((state) => state.start);
  const pause = useWorld((state) => state.pause);
  const reset = useWorld((state) => state.reset);
  const step = useWorld((state) => state.step);
  const chooseScenario = useWorld((state) => state.chooseScenario);
  const chooseSpeed = useWorld((state) => state.chooseSpeed);
  const restore = useWorld((state) => state.restore);

  useEffect(() => {
    const id = window.setInterval(() => useWorld.getState().step(), 1000 / 30);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    let active = true;
    loadWorld().then((world) => {
      if (!active) return;
      if (world) {
        restore(world.snapshot);
        checkpoints.current = world.checkpoints;
        setCheckpointCount(world.checkpoints.length);
        setWorldMessage(`Restored paused · saved ${new Date(world.savedAt).toLocaleString()}`);
      } else setWorldMessage('No saved world');
    }).catch((error: unknown) => setWorldMessage(error instanceof Error ? error.message : 'World restore failed.'));
    return () => { active = false; };
  }, [restore]);
  useEffect(() => {
    if (snap.tick > 0 && snap.tick % 300 === 0 && checkpoints.current.at(-1)?.tick !== snap.tick) {
      checkpoints.current = [...checkpoints.current, { ...snap }].slice(-20);
      setCheckpointCount(checkpoints.current.length);
    }
  }, [snap]);
  useEffect(() => { latestTick.current = snap.tick; }, [snap.tick]);
  useEffect(() => {
    if (!replayPlaying || !replaySnapshot) return;
    const timer = window.setInterval(() => {
      const target = Math.min(latestTick.current, replaySnapshot.tick + replaySpeed);
      try {
        setReplaySnapshot(seekReplay([initialSnapshot(replaySnapshot.scenario), ...checkpoints.current.filter((checkpoint) => checkpoint.scenario === replaySnapshot.scenario)], target));
        if (target >= latestTick.current) setReplayPlaying(false);
      } catch { setReplayPlaying(false); }
    }, 250);
    return () => window.clearInterval(timer);
  }, [replayPlaying, replaySnapshot, replaySpeed]);
  useEffect(() => {
    const save = () => {
      const current = useWorld.getState().snapshot;
      if (!current.tick && !current.events.length) return;
      void saveWorld(current, checkpoints.current).then((world) => {
        setWorldMessage(`Saved at ${new Date(world.savedAt).toLocaleTimeString()}`);
      }).catch((error: unknown) => setWorldMessage(error instanceof Error ? error.message : 'World save failed.'));
    };
    const timer = window.setInterval(save, 15000);
    const visibility = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  const chosenAgent = agents.find((agent) => agent.id === selected);
  const state = snap.agents.find((agent) => agent.id === selected);
  const progress = Math.max(0, Math.min(100, Math.round(((snap.phaseIndex + (snap.phaseTitle.startsWith('Completed') ? 1 : 0)) / scenarioPhaseCount[snap.scenario]) * 100)));
  const recentMessages = snap.events
    .filter((event) => event.type === 'agent.message.sent' && (!selected || event.sourceAgentId === selected))
    .slice(-5)
    .reverse();
  const records = deriveWorldRecords(snap.events);
  const memories = selected ? recall(consolidateMemories(records.memories), { agentId: selected, limit: 8 }) : [];
  const relationships = records.relationships.filter((record) => record.agentId === selected || record.targetAgentId === selected);

  const manualSave = async () => {
    try {
      const world = await saveWorld(useWorld.getState().snapshot, checkpoints.current);
      setWorldMessage(`Saved at ${new Date(world.savedAt).toLocaleTimeString()}`);
    } catch (error) { setWorldMessage(error instanceof Error ? error.message : 'World save failed.'); }
  };
  const exportWorld = async () => {
    try {
      const world = await saveWorld(useWorld.getState().snapshot, checkpoints.current);
      const url = URL.createObjectURL(new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'little-agents-world.json'; anchor.click();
      URL.revokeObjectURL(url);
      setWorldMessage('World exported');
    } catch (error) { setWorldMessage(error instanceof Error ? error.message : 'World export failed.'); }
  };
  const importWorld = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Import rejected: file exceeds 5 MB.');
      const value: unknown = JSON.parse(await file.text());
      const imported = migrateWorld(value);
      await replaceWorld(imported);
      restore(imported.snapshot);
      checkpoints.current = imported.checkpoints;
      setCheckpointCount(imported.checkpoints.length);
      setWorldMessage('Imported world; restored paused');
    } catch (error) { setWorldMessage(error instanceof Error ? error.message : 'World import failed.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  };
  const loadSavedWorld = async () => {
    try {
      const world = await loadWorld();
      if (!world) throw new Error('No saved world found.');
      restore(world.snapshot); checkpoints.current = world.checkpoints; setCheckpointCount(world.checkpoints.length);
      setWorldMessage('Loaded saved world; paused');
    } catch (error) { setWorldMessage(error instanceof Error ? error.message : 'World load failed.'); }
  };
  const resetWorld = async () => {
    if (!window.confirm('Reset simulation and delete saved world?')) return;
    try {
      await deleteWorld(); reset(); checkpoints.current = []; setCheckpointCount(0);
      setWorldMessage('World reset');
    } catch (error) { setWorldMessage(error instanceof Error ? error.message : 'World reset failed.'); }
  };
  const changeScenario = (scenario: ScenarioId) => {
    checkpoints.current = [];
    setCheckpointCount(0);
    setReplaySnapshot(null);
    setReplayPlaying(false);
    chooseScenario(scenario);
  };
  const seekTo = (tick: number) => {
    try {
      setReplaySnapshot(seekReplay([initialSnapshot(snap.scenario), ...checkpoints.current.filter((checkpoint) => checkpoint.scenario === snap.scenario)], tick));
    } catch (error) {
      setWorldMessage(error instanceof Error ? error.message : 'Replay seek failed.');
    }
  };
  const loadLiveRuns = async () => {
    try {
      const response = await fetch('/little-agents-village/api/runs');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not load live execution history.');
      setLiveRuns(result.runs ?? []);
      setLiveMessage(`Live mode ready · ${result.provider} · ${result.model} · read-only planning`);
    } catch (error) {
      setLiveMessage(error instanceof Error ? error.message : 'Live mode unavailable.');
    }
  };
  const startLiveTask = async () => {
    if (!liveTask.trim() || liveController.current) return;
    const controller = new AbortController();
    liveController.current = controller;
    setLiveRunning(true);
    setLiveEvents([]);
    setLiveStatuses({});
    setLiveMessage('Connecting to server execution…');
    try {
      const memoryContext = records.memories.slice(-8).map(({ summary, sourceEventIds }) => ({ summary, sourceEventIds }));
      const response = await fetch('/little-agents-village/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: liveTask, memoryContext }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? `Live task failed (${response.status}).`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const frames = pending.split('\n\n');
        pending = frames.pop() ?? '';
        for (const frame of frames) {
          const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (!data) continue;
          const event = JSON.parse(data) as LiveEvent;
          if (event.eventId) setLiveEvents((current) => current.some((item) => item.eventId === event.eventId) ? current : [...current, event]);
          if (event.type === 'agent.started' && event.agentId) setLiveStatuses((current) => ({ ...current, [event.agentId!]: 'working' }));
          if (event.type === 'agent.completed' && event.agentId) {
            const status = typeof event.payload.status === 'string' ? event.payload.status : 'completed';
            setLiveStatuses((current) => ({ ...current, [event.agentId!]: status }));
          }
          if (event.type === 'agent.failed' && event.agentId) setLiveStatuses((current) => ({ ...current, [event.agentId!]: 'failed' }));
          if (event.type === 'agent.tool.started' && event.agentId) setLiveStatuses((current) => ({ ...current, [event.agentId!]: 'using read-only tool' }));
          if (event.type === 'run.completed') setLiveMessage(`Workflow ended: ${String(event.payload.outcome)} · no files changed · no tests executed`);
          else if (event.type === 'run.failed') setLiveMessage(`Execution failed: ${String(event.payload.error)}`);
          else if (event.type === 'run.cancelled') setLiveMessage('Execution cancelled.');
          else if (event.type === 'stream.error') setLiveMessage(`Execution stream failed: ${String(event.payload.error)}`);
        }
        if (done) break;
      }
      await loadLiveRuns();
    } catch (error) {
      setLiveMessage(error instanceof Error && error.name === 'AbortError' ? 'Cancellation requested…' : error instanceof Error ? error.message : 'Live task failed.');
    } finally {
      liveController.current = null;
      setLiveRunning(false);
    }
  };
  const inspectRun = async (runId: string) => {
    try {
      const response = await fetch(`/little-agents-village/api/runs/${runId}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not load run events.');
      setSelectedRunEvents(result.events ?? []);
    } catch (error) {
      setLiveMessage(error instanceof Error ? error.message : 'Could not inspect run.');
    }
  };
  const testNineRouter = async () => {
    setLiveMessage('Checking 9Router models and testing inference…');
    try {
      let modelInfo = 'model list unavailable';
      const modelsResponse = await fetch('/little-agents-village/api/connection');
      const modelsResult = await modelsResponse.json();
      if (modelsResponse.ok && Array.isArray(modelsResult.models)) {
        modelInfo = `${modelsResult.models.length} models listed`;
      }
      const response = await fetch('/little-agents-village/api/connection', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '9Router connection test failed.');
      setLiveMessage(`9Router request succeeded · ${modelInfo} · ${result.model} · ${result.inputTokens + result.outputTokens} tokens · ${result.response}`);
    } catch (error) {
      setLiveMessage(error instanceof Error ? `9Router error: ${error.message}` : '9Router connection test failed.');
    }
  };

  return (
    <div className="agents-village">
      <header>
        <div>
          <Link href="/" className="back">← App Suite</Link>
          <span className="logo">✿</span>
          <strong>Little Agents Village</strong>
          <span className="subtitle">tiny agents, big ideas</span>
          <label className="mode-toggle">Mode
            <select value={mode} onChange={(event) => {
              const next = event.target.value as 'simulation' | 'live';
              if (next === 'live') pause();
              setMode(next);
            }}>
              <option value="simulation">SIMULATION</option>
              <option value="live">LIVE AI</option>
            </select>
          </label>
        </div>
        <span className="mode">● {mode === 'live' ? 'LIVE · READ-ONLY PLANNING' : 'SIMULATION ONLY · NO LIVE AI'}</span>
      </header>
      <main>
        <section className="world">
          <Village liveStatuses={mode === 'live' ? liveStatuses : {}} />
          <div className="world-tag">🌿 Agent Workspace <small>Drag to orbit · Scroll to zoom · Click agents</small></div>
          <div className="world-clock">T+ {clock(snap.tick)} <i /> {snap.phaseTitle}</div>
        </section>
        <aside>
          <h2>Village Mission ✨</h2>
          <p className="muted">Deterministic software sprint · simulated outcomes only.</p>

          <div className="task">
            <small>SCENARIO · {clock(snap.tick)}</small>
            <select value={snap.scenario} onChange={(event) => changeScenario(event.target.value as ScenarioId)} aria-label="Choose simulation scenario">
              {Object.entries(scenarioLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <h3>{snap.taskTitle}</h3>
            <p>Phase {Math.max(0, snap.phaseIndex + 1)} · {snap.phaseTitle}</p>
            <div className="bar"><div style={{ width: `${progress}%` }} /></div>
            <div className="sim-controls">
              <button onClick={snap.running ? pause : start}>{snap.running ? '⏸ Pause' : '▶ Start / resume'}</button>
              <button className="secondary" onClick={resetWorld}>↻ Reset</button>
              <button className="secondary" onClick={step} disabled={!snap.running}>+ Tick</button>
            </div>
            <label className="speed-control">
              Simulation speed
              <select value={snap.speed} onChange={(event) => chooseSpeed(Number(event.target.value) as 1 | 2 | 4)}>
                <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
              </select>
            </label>
          </div>

          <h3>Our little team</h3>
          <div className="roster">
            {agents.map((agent) => {
              const agentState = snap.agents.find((item) => item.id === agent.id)!;
              return (
                <button key={agent.id} className={`agent ${selected === agent.id ? 'active' : ''}`} onClick={() => select(agent.id)}>
                  <span className="dot" style={{ background: agent.color }} />
                  <span><b>{agent.name}</b><small>{agent.role.replace('_', ' ')}</small></span>
                  <em>{statusLabels[agentState.status]}</em>
                </button>
              );
            })}
          </div>

          {chosenAgent && state && (
            <section className="agent-details" aria-label={`${chosenAgent.name} details`}>
              <h3>{chosenAgent.name} · {chosenAgent.role.replace('_', ' ')}</h3>
              <dl>
                <div><dt>Behavior</dt><dd>{behaviorLabels[state.behavior]}</dd></div>
                <div><dt>Status</dt><dd>{statusLabels[state.status]}</dd></div>
                <div><dt>Activity</dt><dd>{state.activity}</dd></div>
                <div><dt>Destination</dt><dd>{locationName(state.destinationId)}</dd></div>
                <div><dt>Current action</dt><dd>{state.currentAction?.type.replace('_', ' ') ?? '—'}</dd></div>
                <div><dt>Next action</dt><dd>{state.actionQueue[0]?.type.replace('_', ' ') ?? '—'}</dd></div>
                <div><dt>Queue</dt><dd>{state.actionQueue.length} action(s)</dd></div>
              </dl>
              <div className="memory-summary">
                <b>Recent memories</b>
                {memories.length ? memories.map((memory) => <p key={memory.id}>{memory.summary}<small>Tick {memory.createdAtTick} · {memory.type} · source {memory.sourceEventIds.join(', ')}</small></p>) : <p className="muted">No recorded memories yet.</p>}
                <b>Relationships</b>
                {relationships.length ? relationships.map((record) => <p key={`${record.agentId}:${record.targetAgentId}`}>{agents.find((item) => item.id === (record.agentId === selected ? record.targetAgentId : record.agentId))?.name}: {record.collaborationCount} simulated collaboration(s)</p>) : <p className="muted">No recorded collaborations.</p>}
              </div>
            </section>
          )}

          <section className="world-management">
            <h3>World Management</h3>
            <p>World `little-agents-village-default` · Simulation Mode</p>
            <div className="world-actions">
              <button onClick={manualSave}>Save World</button><button onClick={loadSavedWorld}>Load World</button>
              <button onClick={exportWorld}>Export World</button><button onClick={() => fileInput.current?.click()}>Import World</button>
              <button onClick={() => { setReplaySnapshot(seekReplay([initialSnapshot(snap.scenario), ...checkpoints.current.filter((checkpoint) => checkpoint.scenario === snap.scenario)], 0)); setReplayPlaying(false); }}>View Sessions / Replay</button>
              <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importWorld(event.target.files?.[0])} />
            </div>
            <small>{worldMessage}</small>
            <small>{records.taskHistory.length} task events · {records.memories.length} memories · {snap.events.length} events · {checkpointCount} checkpoints</small>
            <div className="task-history" aria-label="Recent task history">
              {records.taskHistory.slice(-6).reverse().map((item) => (
                <small key={item.eventId}>T+{clock(item.tick)} · {item.type.replaceAll('.', ' ')}{item.agentId ? ` · ${agents.find((agent) => agent.id === item.agentId)?.name ?? item.agentId}` : ''}</small>
              ))}
            </div>
            {replaySnapshot && <div className="replay-controls">
              <b>Replay · isolated read-only view</b>
              <small>Tick {replaySnapshot.tick} · {replaySnapshot.phaseTitle}</small>
              <input aria-label="Replay timeline" type="range" min={0} max={Math.max(0, snap.tick)} value={Math.min(replaySnapshot.tick, snap.tick)} onChange={(event) => seekTo(Number(event.target.value))} />
              <div className="world-actions">
                <button onClick={() => seekTo(0)}>Restart</button>
                <button onClick={() => setReplayPlaying((playing) => !playing)}>{replayPlaying ? 'Pause' : 'Play'}</button>
                <select aria-label="Replay speed" value={replaySpeed} onChange={(event) => setReplaySpeed(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
                <button onClick={() => { setReplayPlaying(false); setReplaySnapshot(null); }}>Exit Replay</button>
              </div>
              <small>{replaySnapshot.agents.map((agent) => `${agents.find((item) => item.id === agent.id)?.name}: ${agent.activity}`).join(' · ')}</small>
            </div>}
          </section>

          {mode === 'live' && <section className="live-panel">
            <h3>Live AI Task Runner</h3>
            <p className="muted">Server-side 9Router inference. Read-only workspace tools. No writes, shell, or test execution.</p>
            <div className="world-actions">
              <button onClick={() => void testNineRouter()}>Test 9Router Connection</button>
              <button onClick={() => void loadLiveRuns()}>Connect / Load Runs</button>
            </div>
            <label>Task request
              <textarea value={liveTask} onChange={(event) => setLiveTask(event.target.value)} maxLength={2000} rows={4} placeholder="Describe task for six role agents to analyze." />
            </label>
            <div className="world-actions">
              <button onClick={() => void startLiveTask()} disabled={!liveTask.trim() || liveRunning}>Start Task</button>
              <button onClick={() => liveController.current?.abort()} disabled={!liveRunning}>Cancel Task</button>
            </div>
            <small>{liveMessage}</small>
            {liveEvents.filter((event) => event.type === 'agent.output.created').map((event) => {
              const output = event.payload.result as { status?: string; summary?: string; artifacts?: string[] } | undefined;
              return <article className="live-output" key={event.eventId}>
                <b>{agents.find((agent) => agent.id === event.agentId)?.name ?? event.agentId} · {output?.status}</b>
                <p>{output?.summary}</p>
                {!!output?.artifacts?.length && <small>Artifacts: {output.artifacts.join(', ')}</small>}
              </article>;
            })}
            <small>{liveEvents.reduce((total, event) => total + (typeof event.payload.inputTokens === 'number' ? event.payload.inputTokens : 0) + (typeof event.payload.outputTokens === 'number' ? event.payload.outputTokens : 0), 0)} reported tokens · provider cost not estimated</small>
            <h4>Persisted executions</h4>
            {liveRuns.map((run) => <button className="live-run" key={run.runId} onClick={() => void inspectRun(run.runId)}>{run.status} · {run.model} · {run.inputTokens + run.outputTokens} tokens<br /><small>{run.task}</small></button>)}
            {!!selectedRunEvents.length && <div className="live-log">
              <b>Execution event log</b>
              {selectedRunEvents.map((event) => <small key={event.eventId}>#{event.sequence} · {event.agentId ?? 'system'} · {event.type}</small>)}
            </div>}
          </section>}

          <h3>Recent messages</h3>
          <div className="feed messages">
            {recentMessages.length ? recentMessages.map((event) => (
              <p key={event.id}><small>{clock(event.tick)} · {agents.find((agent) => agent.id === event.sourceAgentId)?.name}</small><br />{event.payload.message}</p>
            )) : <p className="muted">Messages appear when agents communicate.</p>}
          </div>

          <h3>Activity timeline</h3>
          <div className="feed">
            {snap.events.slice(-14).reverse().map((event) => (
              <p key={event.id}><small>{clock(event.tick)} · #{event.id}</small><br />
                {event.sourceAgentId ? `${agents.find((agent) => agent.id === event.sourceAgentId)?.name}: ` : ''}
                {event.type.replaceAll('.', ' ')}
                {typeof event.payload.activity === 'string' ? ` · ${event.payload.activity}` : ''}
              </p>
            ))}
            {!snap.events.length && <p className="muted">Start scenario to begin. Outcomes stay simulated.</p>}
          </div>
          <footer>Fixed-step 30 Hz · Deterministic events · No LLM calls or real code execution</footer>
        </aside>
      </main>
    </div>
  );
}

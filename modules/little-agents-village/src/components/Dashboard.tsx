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
type PanelId = 'overview' | 'agents' | 'tasks' | 'activity' | 'settings';
const panels: { id: PanelId; icon: string; label: string }[] = [
  { id: 'overview', icon: '◫', label: 'Overview' },
  { id: 'agents', icon: '◉', label: 'Agents' },
  { id: 'tasks', icon: '▤', label: 'Tasks' },
  { id: 'activity', icon: '≋', label: 'Activity' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

export function Dashboard() {
  const [activePanel, setActivePanel] = useState<PanelId>('overview');
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
  const activeAgentCount = snap.agents.filter((agent) => agent.status !== 'idle').length;
  const completedTaskCount = snap.events.filter((event) => event.type === 'task.completed').length;
  const isComplete = snap.phaseTitle.startsWith('Completed');
  const runDemo = () => {
    changeScenario('qa-rework');
    useWorld.getState().start();
    setActivePanel('activity');
  };

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

  const agentRoster = (
    <div className="agent-roster">
      {agents.map((agent) => {
        const agentState = snap.agents.find((item) => item.id === agent.id)!;
        return (
          <button key={agent.id} className={`agent-row ${selected === agent.id ? 'active' : ''}`} onClick={() => select(agent.id)}>
            <span className="agent-avatar" style={{ '--agent-color': agent.color } as React.CSSProperties}>{agent.name.slice(0, 1)}</span>
            <span className="agent-copy"><b>{agent.name}</b><small>{agent.role.replace('_', ' ')}</small></span>
            <span className={`status-pill status-${agentState.status}`}>{statusLabels[agentState.status]}</span>
          </button>
        );
      })}
    </div>
  );
  const taskControls = (
    <>
      <div className="field-group">
        <label htmlFor="scenario">Simulation scenario</label>
        <select id="scenario" className="field" value={snap.scenario} onChange={(event) => changeScenario(event.target.value as ScenarioId)}>
          {Object.entries(scenarioLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className="mission-card">
        <div className="eyebrow">CURRENT RUN · {clock(snap.tick)}</div>
        <h3>{snap.taskTitle}</h3>
        <div className="phase-line"><span>{snap.phaseTitle}</span><b>{progress}%</b></div>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="button-row">
        <button className="button button-primary" onClick={snap.running ? pause : start}>{snap.running ? 'Pause simulation' : 'Start simulation'}</button>
        <button className="button button-quiet" onClick={step} disabled={!snap.running}>+ Tick</button>
      </div>
      <div className="field-group">
        <label htmlFor="speed">Simulation speed</label>
        <select id="speed" className="field" value={snap.speed} onChange={(event) => chooseSpeed(Number(event.target.value) as 1 | 2 | 4)}>
          <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
        </select>
      </div>
    </>
  );
  const liveTaskPanel = (
    <section className="panel-card">
      <div className="card-heading">
        <div><span className="eyebrow">LIVE BACKEND</span><h3>9Router task runner</h3></div>
        <span className={`status-pill ${mode === 'live' ? 'status-working' : 'status-idle'}`}>{mode === 'live' ? 'Connected mode' : 'Inactive'}</span>
      </div>
      <p className="muted">Server-side inference. Read-only workspace tools; no shell, file writes, or test execution.</p>
      <label className="field-group">Task request
        <textarea className="field" value={liveTask} onChange={(event) => setLiveTask(event.target.value)} maxLength={2000} rows={4} placeholder="Describe task for six role agents to analyze." />
      </label>
      <div className="button-row">
        <button className="button button-primary" onClick={() => void startLiveTask()} disabled={!liveTask.trim() || liveRunning}>Start live task</button>
        <button className="button button-quiet" onClick={() => liveController.current?.abort()} disabled={!liveRunning}>Cancel</button>
      </div>
      {liveMessage && <p className="notice" role="status">{liveMessage}</p>}
      {liveEvents.filter((event) => event.type === 'agent.output.created').map((event) => {
        const output = event.payload.result as { status?: string; summary?: string; artifacts?: string[] } | undefined;
        return <article className="live-output" key={event.eventId}>
          <b>{agents.find((agent) => agent.id === event.agentId)?.name ?? event.agentId} · {output?.status}</b>
          <p>{output?.summary}</p>
          {!!output?.artifacts?.length && <small>Artifacts: {output.artifacts.join(', ')}</small>}
        </article>;
      })}
      <small className="token-note">{liveEvents.reduce((total, event) => total + (typeof event.payload.inputTokens === 'number' ? event.payload.inputTokens : 0) + (typeof event.payload.outputTokens === 'number' ? event.payload.outputTokens : 0), 0)} reported tokens · cost not estimated</small>
      <h4>Persisted executions</h4>
      {liveRuns.map((run) => <button className="live-run" key={run.runId} onClick={() => void inspectRun(run.runId)}>{run.status} · {run.model} · {run.inputTokens + run.outputTokens} tokens<br /><small>{run.task}</small></button>)}
      {!!selectedRunEvents.length && <div className="live-log"><b>Execution event log</b>{selectedRunEvents.map((event) => <small key={event.eventId}>#{event.sequence} · {event.agentId ?? 'system'} · {event.type}</small>)}</div>}
    </section>
  );
  const worldTools = (
    <>
      <div className="button-grid">
        <button className="button button-quiet" onClick={manualSave}>Save world</button>
        <button className="button button-quiet" onClick={loadSavedWorld}>Load world</button>
        <button className="button button-quiet" onClick={exportWorld}>Export JSON</button>
        <button className="button button-quiet" onClick={() => fileInput.current?.click()}>Import JSON</button>
        <button className="button button-quiet" onClick={() => { setReplaySnapshot(seekReplay([initialSnapshot(snap.scenario), ...checkpoints.current.filter((checkpoint) => checkpoint.scenario === snap.scenario)], 0)); setReplayPlaying(false); }}>Open replay</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importWorld(event.target.files?.[0])} />
      </div>
      <p className="notice">{worldMessage}</p>
      <small className="token-note">{records.taskHistory.length} task events · {records.memories.length} memories · {snap.events.length} events · {checkpointCount} checkpoints</small>
      {replaySnapshot && <div className="replay-controls">
        <b>Replay · isolated read-only view</b>
        <small>Tick {replaySnapshot.tick} · {replaySnapshot.phaseTitle}</small>
        <input aria-label="Replay timeline" type="range" min={0} max={Math.max(0, snap.tick)} value={Math.min(replaySnapshot.tick, snap.tick)} onChange={(event) => seekTo(Number(event.target.value))} />
        <div className="button-grid">
          <button className="button button-quiet" onClick={() => seekTo(0)}>Restart</button>
          <button className="button button-quiet" onClick={() => setReplayPlaying((playing) => !playing)}>{replayPlaying ? 'Pause' : 'Play'}</button>
          <select className="field" aria-label="Replay speed" value={replaySpeed} onChange={(event) => setReplaySpeed(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
          <button className="button button-quiet" onClick={() => { setReplayPlaying(false); setReplaySnapshot(null); }}>Exit replay</button>
        </div>
      </div>}
    </>
  );

  return (
    <div className="agents-village">
      <header className="topbar">
        <Link href="/" className="brand-lockup" aria-label="Back to App Suite">
          <span className="brand-mark">AW</span>
          <span><b>AI AGENT WORLD</b><small>Collaborative simulation workspace</small></span>
        </Link>
        <div className="topbar-metrics" aria-label="Simulation metrics">
          <div><small>AGENTS</small><b>{snap.agents.length.toString().padStart(2, '0')}</b></div>
          <div><small>ACTIVE</small><b>{activeAgentCount.toString().padStart(2, '0')}</b></div>
          <div><small>COMPLETED</small><b>{completedTaskCount.toString().padStart(2, '0')}</b></div>
          <div className="run-state"><i className={snap.running ? 'pulse-dot' : ''} /><span>{snap.running ? 'RUNNING' : isComplete ? 'COMPLETE' : 'READY'}</span></div>
        </div>
        <div className="topbar-actions">
          <span className={`mode-badge ${mode === 'simulation' ? 'simulated' : 'live'}`}>{mode === 'simulation' ? 'SIMULATION · NO INFERENCE' : 'LIVE · READ-ONLY'}</span>
          <button className="button button-primary top-start" onClick={snap.running ? pause : start}>{snap.running ? 'Pause' : 'Start'}</button>
        </div>
      </header>

      <div className="workspace">
        <nav className="nav-rail" aria-label="Workspace sections">
          {panels.map((panel) => <button key={panel.id} className={`nav-item ${activePanel === panel.id ? 'selected' : ''}`} onClick={() => setActivePanel(panel.id)} aria-current={activePanel === panel.id ? 'page' : undefined}>
            <span>{panel.icon}</span><small>{panel.label}</small>
          </button>)}
          <div className="rail-bottom"><span className="rail-dot" /><small>LOCAL<br />WORLD</small></div>
        </nav>

        <main className="world-stage">
          <Village liveStatuses={mode === 'live' ? liveStatuses : {}} />
          <div className="scene-caption"><span className="eyebrow">WORLD VIEW / 01</span><b>{snap.taskTitle}</b><small>{clock(snap.tick)} · {snap.phaseTitle}</small></div>
          <div className="scene-hint">DRAG TO ORBIT <i /> SCROLL TO ZOOM <i /> SELECT AGENT</div>
        </main>

        <aside className="side-panel" aria-live="polite">
          <div className="panel-heading">
            <div><span className="eyebrow">{activePanel.toUpperCase()} / WORLD CONTROL</span><h1>{panels.find((item) => item.id === activePanel)?.label}</h1></div>
            <button className="icon-button" aria-label="Reset simulation" onClick={resetWorld}>↺</button>
          </div>

          {activePanel === 'overview' && <div className="panel-content">
            <div className="demo-callout">
              <span className="eyebrow">DETERMINISTIC DEMO</span>
              <h2>Watch the team ship a feature.</h2>
              <p>Mochi coordinates; Luna plans; Foxy researches; Pip builds; Bobo tests; Ollie reviews. No LLM inference or code execution in simulation mode.</p>
              <button className="button button-primary" onClick={runDemo}>Run QA rework demo</button>
            </div>
            <section className="panel-section">
              <div className="section-title"><h2>Current mission</h2><span className="status-pill status-working">{progress}%</span></div>
              <h3>{snap.taskTitle}</h3><p className="muted">{snap.phaseTitle} · {clock(snap.tick)} elapsed</p>
              <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
              <div className="button-row">
                <button className="button button-secondary" onClick={snap.running ? pause : start}>{snap.running ? 'Pause' : 'Resume simulation'}</button>
                <select className="field compact-field" aria-label="Simulation speed" value={snap.speed} onChange={(event) => chooseSpeed(Number(event.target.value) as 1 | 2 | 4)}>
                  <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
                </select>
              </div>
            </section>
            <section className="panel-section"><div className="section-title"><h2>Team status</h2><button className="text-button" onClick={() => setActivePanel('agents')}>View all</button></div>{agentRoster}</section>
            <section className="panel-section">
              <div className="section-title"><h2>Latest activity</h2><button className="text-button" onClick={() => setActivePanel('activity')}>Open feed</button></div>
              <div className="event-list">{snap.events.slice(-5).reverse().map((event) => <div className="event-row" key={event.id}><i /><span><b>{event.sourceAgentId ? agents.find((agent) => agent.id === event.sourceAgentId)?.name : 'System'}</b><small>{event.type.replaceAll('.', ' ')} · T+{clock(event.tick)}</small></span></div>)}
                {!snap.events.length && <p className="empty-state">Run demo to see real simulation events.</p>}
              </div>
            </section>
          </div>}

          {activePanel === 'agents' && <div className="panel-content">
            <p className="panel-intro">Six role agents. Select agent in roster or world to inspect current state and persistent memories.</p>
            <section className="panel-section">{agentRoster}</section>
            {chosenAgent && state && <section className="panel-card agent-inspector">
              <div className="agent-profile">
                <span className="agent-avatar large" style={{ '--agent-color': chosenAgent.color } as React.CSSProperties}>{chosenAgent.name.slice(0, 1)}</span>
                <span><h2>{chosenAgent.name}</h2><small>{chosenAgent.role.replace('_', ' ')}</small></span>
                <span className={`status-pill status-${state.status}`}>{statusLabels[state.status]}</span>
              </div>
              <dl className="detail-list">
                <div><dt>Behavior</dt><dd>{behaviorLabels[state.behavior]}</dd></div>
                <div><dt>Activity</dt><dd>{state.activity}</dd></div>
                <div><dt>Destination</dt><dd>{locationName(state.destinationId)}</dd></div>
                <div><dt>Current action</dt><dd>{state.currentAction?.type.replace('_', ' ') ?? '—'}</dd></div>
                <div><dt>Queued actions</dt><dd>{state.actionQueue.length}</dd></div>
              </dl>
              <div className="subsection-title">Recent memories</div>
              {memories.length ? memories.map((memory) => <p className="memory-entry" key={memory.id}>{memory.summary}<small>Tick {memory.createdAtTick} · {memory.type}</small></p>) : <p className="empty-state">No memories recorded yet.</p>}
              <div className="subsection-title">Relationships</div>
              {relationships.length ? relationships.map((record) => <p className="memory-entry" key={`${record.agentId}:${record.targetAgentId}`}>{agents.find((item) => item.id === (record.agentId === selected ? record.targetAgentId : record.agentId))?.name}: {record.collaborationCount} simulated collaborations</p>) : <p className="empty-state">No recorded collaborations.</p>}
            </section>}
          </div>}

          {activePanel === 'tasks' && <div className="panel-content">
            <p className="panel-intro">Run repeatable scenarios or submit a read-only planning request to configured live backend.</p>
            <section className="panel-card"><span className="eyebrow">SIMULATION MODE · NO LIVE AI</span><h2>Scenario runner</h2>{taskControls}<button className="button button-danger-quiet" onClick={() => void resetWorld()}>Reset world</button></section>
            {liveTaskPanel}
            <section className="panel-card"><div className="card-heading"><div><span className="eyebrow">PERSISTENCE</span><h3>World sessions</h3></div></div>{worldTools}
              <div className="task-history">{records.taskHistory.slice(-8).reverse().map((item) => <small key={item.eventId}>T+{clock(item.tick)} · {item.type.replaceAll('.', ' ')}{item.agentId ? ` · ${agents.find((agent) => agent.id === item.agentId)?.name ?? item.agentId}` : ''}</small>)}</div>
            </section>
          </div>}

          {activePanel === 'activity' && <div className="panel-content">
            <p className="panel-intro">Event log comes from deterministic simulation events. Timeline does not imply live inference.</p>
            <section className="panel-section"><div className="section-title"><h2>Agent messages</h2><span className="count">{recentMessages.length}</span></div>
              <div className="event-list">{recentMessages.map((event) => <div className="event-row message-row" key={event.id}><i /><span><b>{agents.find((agent) => agent.id === event.sourceAgentId)?.name}</b><small>{clock(event.tick)} · {event.payload.message}</small></span></div>)}
                {!recentMessages.length && <p className="empty-state">Messages appear when agents communicate.</p>}
              </div>
            </section>
            <section className="panel-section"><div className="section-title"><h2>Event timeline</h2><span className="count">{snap.events.length}</span></div>
              <div className="timeline">{snap.events.slice(-32).reverse().map((event) => <article className="timeline-item" key={event.id}><span className="timeline-dot" /><div><small>T+{clock(event.tick)} · #{event.id}</small><b>{event.sourceAgentId ? `${agents.find((agent) => agent.id === event.sourceAgentId)?.name}: ` : ''}{event.type.replaceAll('.', ' ')}</b>{typeof event.payload.activity === 'string' && <p>{event.payload.activity}</p>}</div></article>)}
                {!snap.events.length && <p className="empty-state">Start simulation to populate timeline.</p>}
              </div>
            </section>
          </div>}

          {activePanel === 'settings' && <div className="panel-content">
            <section className="panel-card"><span className="eyebrow">EXECUTION MODE</span><h2>Backend</h2>
              <div className="field-group"><label htmlFor="mode">Agent runtime</label><select id="mode" className="field" value={mode} onChange={(event) => {
                const next = event.target.value as 'simulation' | 'live';
                if (next === 'live') pause();
                setMode(next);
              }}><option value="simulation">Simulation · deterministic · no LLM calls</option><option value="live">Live AI · server-side 9Router</option></select></div>
              <p className="notice">{mode === 'simulation' ? 'Canned deterministic outcomes. No inference, code writes, or command execution.' : 'Read-only planning through server provider. API keys remain server-side.'}</p>
              <div className="settings-row"><span>World</span><b>little-agents-village-default</b></div>
              <div className="settings-row"><span>Simulation tick</span><b>30 Hz</b></div>
              <div className="settings-row"><span>Events recorded</span><b>{snap.events.length}</b></div>
              <div className="settings-row"><span>Save state</span><b>{worldMessage}</b></div>
            </section>
            <section className="panel-card"><span className="eyebrow">PROVIDER CHECK</span><h2>9Router connection</h2>
              <p className="muted">Uses server environment configuration. Browser never receives provider keys.</p>
              <div className="button-row"><button className="button button-secondary" onClick={() => void testNineRouter()}>Test connection</button><button className="button button-quiet" onClick={() => void loadLiveRuns()}>Load runs</button></div>
              {liveMessage && <p className="notice" role="status">{liveMessage}</p>}
              <small className="token-note">Backend: server-side · tools: read-only · cost: not estimated</small>
            </section>
            <section className="panel-card"><span className="eyebrow">WORLD DATA</span><h2>Persistence & replay</h2><p className="muted">Save, export, import, or replay deterministic world snapshots.</p>{worldTools}</section>
          </div>}
          <footer className="panel-footer">Fixed-step simulation · persistent memory · server-only keys</footer>
        </aside>
      </div>
    </div>
  );
}

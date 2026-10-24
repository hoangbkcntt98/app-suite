# Little Agents Village 🌿

Cute AI Agent World prototype using React 19, Three.js, React Three Fiber 9, drei, Zustand and TypeScript.

## App Suite

This module runs inside the App Suite Next.js app at `/little-agents-village`.
Start the app from the repository root with `npm run dev`.

Validate with `npm run test:agents`.
Optional paid provider smoke test: `RUN_LIVE_AI_SMOKE=true npm run test:agents`
with AWS credentials and live model configuration available to Node.

## MVP features

- Procedural animal characters: rabbit, fox, cat, penguin, bear, owl
- Pastel 3D village with houses, trees, roads and orbit camera
- Three deterministic simulated sprint scenarios, including QA failure and rework
- A* movement on fixed walkable grid, typed action queues and replayable event log
- Event-driven speech bubbles, collaboration links, simulation speed controls
- Zustand world snapshot, agent selection, activity feed
- Start/pause/reset controls
- IndexedDB world saves, paused restore, periodic snapshots, JSON import/export
- Traceable event-derived agent memories, deterministic retrieval/consolidation and task timelines
- Event-derived collaborator metrics and isolated checkpoint-based replay controls
- Clearly labeled simulation; no LLM or code execution

## Architecture

`src/data` defines agents. `src/simulation/navigation.ts` plans deterministic
grid routes around static structures. `src/simulation/engine.ts` owns fixed-step
state, per-agent action queues, scenarios and typed events. `src/store` bridges
the simulation to React, while `src/world` renders state and `src/components`
holds dashboard UI. Rendering never advances simulation state.

`src/persistence` stores a versioned JSON world envelope in IndexedDB. Envelope
contains authoritative snapshot, event sequence, derived memories/task history/
relationships, and replay checkpoints. Restore always pauses simulation. Saves
are transactional and happen on manual request, every 15 seconds, and when the
tab becomes hidden; periodic checkpoints avoid per-tick storage writes. The
import path enforces a 5 MB limit and migrates schema 0 to schema 1.

`src/memory/MemoryService.ts` derives idempotent memory records from meaningful
event IDs, ranks recall queries deterministically, and consolidates low-priority
records while retaining source IDs. `src/replay/ReplayEngine.ts` seeks from the
nearest checkpoint and runs the existing fixed-step engine in an isolated
snapshot; replay controls do not update the live Zustand world.

## Live AI (read-only MVP)

Dashboard mode selector separates SIMULATION from LIVE AI. Live mode uses
server-only 9Router inference through the official OpenAI JavaScript SDK. Configure:

- `LITTLE_AGENTS_LIVE_ENABLED=true`
- `LITTLE_AGENTS_LIVE_TRUSTED_PROXY=true`
- `LITTLE_AGENTS_LIVE_TRUSTED_HEADER=x-authenticated-user` (or identity header set by trusted proxy)
- `NINE_ROUTER_BASE_URL` (defaults to local `http://127.0.0.1:20128/v1`; cloud: `https://9router.com/v1`)
- `NINE_ROUTER_API_KEY` when configured gateway requires authentication
- `NINE_ROUTER_MODEL` to an ID returned by the configured gateway's `/v1/models`
- Optional `NINE_ROUTER_MODEL_MOCHI`, `_FOXY`, `_LUNA`, `_PIP`, `_BOBO`, `_OLLIE` overrides; unset agents use shared model
- `LITTLE_AGENTS_DATABASE_URL` for dedicated PostgreSQL storage
- `LITTLE_AGENTS_DATABASE_SSL=true` when database host requires TLS

Put App Suite behind an authenticating reverse proxy that strips client-supplied
identity headers and sets configured trusted header. Do not expose Next.js
directly while trusted-proxy mode is enabled. Then open `/little-agents-village`,
choose LIVE AI, use **Test 9Router Connection**, then submit task. Use `/api/connection`
under the module route to list available model IDs. No provider credentials or access
secrets enter browser. Server creates
`little_agents_runs` and `little_agents_events` tables on first authorized
request. Use dedicated database role and restrict route at deployment edge too.

Six role agents (Mochi, Foxy, Luna, Pip, Bobo, Ollie) run in bounded sequence.
Zod validates structured outputs. Foxy can research authorized workspace files;
model-requested tools pass through per-agent allowlists and validated read-only
tool handlers. No model-generated command executes.
Authenticated SSE streams live events; PostgreSQL records runs and ordered
events. Village shows backend agent statuses. Phase 4 local simulation remains
separate and authoritative only in SIMULATION mode.

**Safety boundary:** secure write/shell sandbox is not configured, so LIVE AI is
read-only planning mode. Workspace tools list/read files only inside this module;
path traversal, hidden files, external symlinks, large files, shell, writes,
package installs, network, and test execution stay disabled. Pip, Bobo and Ollie
therefore return blocked outcomes; outputs never imply code changed or tests
passed. Sensitive actions cannot run, so approval UI is not enabled. Amazon
Simulation Mode remains deterministic and does not use 9Router. The Test action
and **Connect / Load Runs** require configured authenticated proxy and a reachable
gateway. Real provider integration is not verified until a real request succeeds.

## Next phases

1. Add isolated resource-limited workspace with explicit approval before enabling writes or shell.
2. Add isolated resource-limited workspace with explicit approval before enabling writes, shell, or test execution.
3. Add cancellation recovery and cost controls, plus WebSocket transport if deployment supports it.
4. Add dynamic agent avoidance and more flexible waypoint editing.

Inspired by the architecture ideas in https://github.com/lucwj/ai-agent-3d-prompts . This is an independent implementation, not its original source code.

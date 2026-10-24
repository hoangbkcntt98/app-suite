import {create} from 'zustand';
import {
  advance,
  initialSnapshot,
  setScenario,
  setSpeed,
  start,
  type ScenarioId,
  type Snapshot,
} from '../simulation/engine';

type WorldStore = {
  snapshot: Snapshot;
  selected: string | null;
  start: () => void;
  pause: () => void;
  reset: () => void;
  step: () => void;
  select: (id: string | null) => void;
  chooseScenario: (scenario: ScenarioId) => void;
  chooseSpeed: (speed: Snapshot['speed']) => void;
  restore: (snapshot: Snapshot) => void;
};

export const useWorld = create<WorldStore>((set) => ({
  snapshot: initialSnapshot(),
  selected: null,
  start: () => set((state) => ({ snapshot: start(state.snapshot) })),
  pause: () => set((state) => ({ snapshot: { ...state.snapshot, running: false } })),
  reset: () => set((state) => ({ snapshot: initialSnapshot(state.snapshot.scenario), selected: null })),
  step: () => set((state) => {
    let snapshot = state.snapshot;
    for (let i = 0; i < snapshot.speed && snapshot.running; i += 1) snapshot = advance(snapshot);
    return { snapshot };
  }),
  select: (selected) => set({ selected }),
  chooseScenario: (scenario: ScenarioId) => set({ snapshot: setScenario(scenario), selected: null }),
  chooseSpeed: (speed) => set((state) => ({ snapshot: setSpeed(state.snapshot, speed) })),
  restore: (snapshot) => set({ snapshot: { ...snapshot, running: false }, selected: null }),
}));

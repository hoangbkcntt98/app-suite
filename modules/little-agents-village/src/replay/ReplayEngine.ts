import { advance, type Snapshot } from '../simulation/engine';

export function seekReplay(checkpoints: Snapshot[], targetTick: number): Snapshot {
  if (!checkpoints.length) throw new Error('Replay unavailable: no checkpoint was saved.');
  const checkpoint = [...checkpoints]
    .filter((item) => item.tick <= targetTick)
    .sort((a, b) => b.tick - a.tick)[0];
  if (!checkpoint) throw new Error('Replay unavailable: target is earlier than first checkpoint.');
  let snapshot: Snapshot = { ...checkpoint, running: true };
  while (snapshot.tick < targetTick && snapshot.running) snapshot = advance(snapshot);
  if (snapshot.tick !== targetTick) throw new Error('Replay unavailable: target tick exceeds recorded simulation.');
  return { ...snapshot, running: false };
}

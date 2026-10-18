export interface IricSvChange {
  timeMs: number;
  sv: number;
}

function integrateDistance(fromMs: number, toMs: number, sortedChanges: IricSvChange[]): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs === toMs) return 0;
  if (toMs < fromMs) return -integrateDistance(toMs, fromMs, sortedChanges);

  let cursor = fromMs;
  let multiplier = 1;
  let distance = 0;
  for (const change of sortedChanges) {
    if (change.timeMs <= fromMs) {
      multiplier = change.sv;
      continue;
    }
    if (change.timeMs >= toMs) break;
    distance += (change.timeMs - cursor) * multiplier;
    cursor = change.timeMs;
    multiplier = change.sv;
  }
  distance += (toMs - cursor) * multiplier;
  return distance;
}

/** Integrate chart distance across piecewise-constant Iris Package SV changes. */
export function getIricScrollDistance(fromMs: number, toMs: number, changes: IricSvChange[] = []): number {
  const sortedChanges = changes
    .filter(change => Number.isFinite(change.timeMs) && Number.isFinite(change.sv) && change.sv >= 0)
    .sort((a, b) => a.timeMs - b.timeMs);
  return integrateDistance(fromMs, toMs, sortedChanges);
}

/** Prepare an SV integrator once for animation loops that query many notes. */
export function createIricScrollDistance(changes: IricSvChange[] = []): (fromMs: number, toMs: number) => number {
  const sortedChanges = changes
    .filter(change => Number.isFinite(change.timeMs) && Number.isFinite(change.sv) && change.sv >= 0)
    .sort((a, b) => a.timeMs - b.timeMs);
  return (fromMs, toMs) => integrateDistance(fromMs, toMs, sortedChanges);
}

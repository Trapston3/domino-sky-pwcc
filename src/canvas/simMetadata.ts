import type {
  FlightNetworkDataset,
  SimulatedFlight,
  SimulationResult,
} from '../engine/types.js';
import type { SceneBuffers } from './arcBuffers.js';

export const TRAIL_POINTS = 16;
export const FLAG_PREVIEW_CANCELLED = 1;
export const FLAG_PREVIEW_CHANGED = 2;
export const FLAG_SELECTED_TAIL = 4;
export const FLAG_SELECTED_FLIGHT = 8;

export interface MetadataScratch {
  simFlightById: Map<string, SimulatedFlight>;
  previewFlightById: Map<string, SimulatedFlight>;
  changedTails: Set<string>;
  selectedTailAirports: Set<string>;
}

/**
 * Allocates reusable scratch maps/sets for simulation/preview metadata updates.
 */
export function createMetadataScratch(): MetadataScratch {
  return {
    simFlightById: new Map(),
    previewFlightById: new Map(),
    changedTails: new Set(),
    selectedTailAirports: new Set(),
  };
}

/**
 * Recomputes per-flight visual metadata flags (preview diffs, selected tail chain)
 * and airport declutter priorities only when simulation, preview, or selection changes.
 */
export function rebuildSceneMetadata(
  buffers: SceneBuffers,
  scratch: MetadataScratch,
  dataset: FlightNetworkDataset,
  simulation: SimulationResult,
  previewSimulation: SimulationResult | null,
  selectedFlightId: string | null,
  selectedTailId: string | null,
  selectedAirportId: string | null
): void {
  scratch.simFlightById.clear();
  for (const f of simulation.flights) {
    scratch.simFlightById.set(f.flight_id, f);
  }

  scratch.previewFlightById.clear();
  scratch.changedTails.clear();
  if (previewSimulation) {
    for (const pf of previewSimulation.flights) {
      scratch.previewFlightById.set(pf.flight_id, pf);
      const cf = scratch.simFlightById.get(pf.flight_id);
      if (!cf) continue;
      const changed =
        pf.operatingTail !== cf.operatingTail ||
        (!pf.cancelled &&
          (pf.delayMin < cf.delayMin ||
            (cf.crewBreachLeg && !pf.crewBreachLeg) ||
            pf.actualDepMin !== cf.actualDepMin));
      if (changed) {
        scratch.changedTails.add(pf.operatingTail);
        scratch.changedTails.add(cf.operatingTail);
      }
    }
    for (let c = 0; c < previewSimulation.connections.length; c++) {
      const pc = previewSimulation.connections[c];
      const cc = simulation.connections[c];
      if (cc && cc.status === 'broken' && pc.status === 'made') {
        const fromF = scratch.previewFlightById.get(pc.from_flight);
        const toF = scratch.previewFlightById.get(pc.to_flight);
        if (fromF) scratch.changedTails.add(fromF.operatingTail);
        if (toF) scratch.changedTails.add(toF.operatingTail);
      }
    }
  }

  const displaySim = previewSimulation ?? simulation;
  const displayMap = previewSimulation ? scratch.previewFlightById : scratch.simFlightById;
  scratch.selectedTailAirports.clear();

  const selectedSimFlight = selectedFlightId ? displayMap.get(selectedFlightId) : undefined;
  const effectiveTailId = selectedTailId ?? selectedSimFlight?.operatingTail ?? null;

  let hasOperatingTailMatch = false;
  if (effectiveTailId) {
    for (const f of displaySim.flights) {
      if (f.operatingTail === effectiveTailId && !f.cancelled) {
        hasOperatingTailMatch = true;
        break;
      }
    }
  }

  for (let i = 0; i < buffers.flightCount; i++) {
    const df = dataset.flights[i];
    const cf = scratch.simFlightById.get(df.flight_id);
    const pf = previewSimulation ? scratch.previewFlightById.get(df.flight_id) : undefined;
    const active = pf ?? cf ?? (displaySim.flights[i] as SimulatedFlight);
    buffers.activeFlightsOrdered[i] = active;

    let flags = 0;
    if (pf && cf) {
      if (!cf.cancelled && pf.cancelled) {
        flags |= FLAG_PREVIEW_CANCELLED;
      } else if (
        !pf.cancelled &&
        (scratch.changedTails.has(pf.operatingTail) || pf.operatingTail !== cf.operatingTail)
      ) {
        flags |= FLAG_PREVIEW_CHANGED;
      }
    }

    const matchesSelectedTail =
      effectiveTailId !== null &&
      (hasOperatingTailMatch
        ? active.operatingTail === effectiveTailId
        : active.tail_id === effectiveTailId);

    if (matchesSelectedTail) {
      flags |= FLAG_SELECTED_TAIL;
      if (!active.cancelled) {
        scratch.selectedTailAirports.add(active.origin);
        scratch.selectedTailAirports.add(active.destination);
      }
    }

    if (selectedFlightId && active.flight_id === selectedFlightId) {
      flags |= FLAG_SELECTED_FLIGHT;
    }

    buffers.flightMetaFlags[i] = flags;
  }

  const closedId = displaySim.closure?.airport ?? null;
  for (let i = 0; i < buffers.airportCount; i++) {
    const a = dataset.airports[i];
    let prio = 5;
    if (closedId === a.id) prio = 0;
    else if (
      selectedAirportId === a.id ||
      selectedSimFlight?.origin === a.id ||
      selectedSimFlight?.destination === a.id
    ) {
      prio = 1;
    } else if (scratch.selectedTailAirports.has(a.id)) prio = 2;
    else if (a.tier === 'mega_hub') prio = 3;
    else if (a.tier === 'regional_hub') prio = 4;
    buffers.airportPriority[i] = prio;
    buffers.airportSortOrder[i] = i;
  }

  for (let i = 1; i < buffers.airportCount; i++) {
    const key = buffers.airportSortOrder[i];
    const keyPrio = buffers.airportPriority[key];
    const keyCap = dataset.airports[key].capacity_per_hour;
    let j = i - 1;
    while (j >= 0) {
      const cmp = buffers.airportSortOrder[j];
      const cmpPrio = buffers.airportPriority[cmp];
      const cmpCap = dataset.airports[cmp].capacity_per_hour;
      if (cmpPrio > keyPrio || (cmpPrio === keyPrio && cmpCap < keyCap)) {
        buffers.airportSortOrder[j + 1] = cmp;
        j--;
      } else {
        break;
      }
    }
    buffers.airportSortOrder[j + 1] = key;
  }
}

/**
 * Updates airborne flags and pre-allocated comet trail ring buffers for `currentTimeMin`.
 * Resets cleanly on large time jumps (scrubbing) or simulation switches.
 */
export function updateCometTrails(
  buffers: SceneBuffers,
  currentTimeMin: number,
  forceReset: boolean
): void {
  const delta = currentTimeMin - buffers.lastTrailTimeMin;
  const largeJump =
    forceReset ||
    Number.isNaN(buffers.lastTrailTimeMin) ||
    delta < -0.001 ||
    delta > 8;

  if (largeJump) {
    buffers.resetTrails();
  }
  buffers.lastTrailTimeMin = currentTimeMin;

  for (let i = 0; i < buffers.flightCount; i++) {
    const f = buffers.activeFlightsOrdered[i];
    const dur = f.actualArrMin - f.actualDepMin;
    const isAirborne =
      !f.cancelled &&
      dur > 0 &&
      currentTimeMin >= f.actualDepMin &&
      currentTimeMin < f.actualArrMin;

    buffers.flightAirborne[i] = isAirborne ? 1 : 0;

    if (!isAirborne) {
      if (buffers.trailCount[i] !== 0) {
        buffers.trailCount[i] = 0;
        buffers.trailLastU[i] = -1;
      }
      continue;
    }

    const u = (currentTimeMin - f.actualDepMin) / dur;
    if (largeJump || buffers.trailLastU[i] < 0) {
      const seedSpan = Math.min(u, Math.min(0.28, 14 / dur));
      const seedSamples = seedSpan > 0.002 ? TRAIL_POINTS : 2;
      buffers.trailHead[i] = 0;
      buffers.trailCount[i] = seedSamples;
      const baseSlot = i * TRAIL_POINTS * 3;
      for (let s = 0; s < seedSamples; s++) {
        const t = seedSamples > 1 ? s / (seedSamples - 1) : 1;
        const su = Math.max(0, u - seedSpan * (1 - t));
        buffers.sampleArc(i, su, buffers.scratchSample);
        const off = baseSlot + s * 3;
        buffers.trailCoords[off] = buffers.scratchSample[0];
        buffers.trailCoords[off + 1] = buffers.scratchSample[1];
        buffers.trailCoords[off + 2] = buffers.scratchSample[2];
      }
      buffers.trailHead[i] = seedSamples % TRAIL_POINTS;
      buffers.trailLastU[i] = u;
    } else if (u - buffers.trailLastU[i] >= 0.005) {
      const stepGap = u - buffers.trailLastU[i];
      const subSteps = stepGap > 0.04 ? Math.min(4, Math.ceil(stepGap / 0.02)) : 1;
      const baseSlot = i * TRAIL_POINTS * 3;
      for (let s = 1; s <= subSteps; s++) {
        const su = buffers.trailLastU[i] + (stepGap * s) / subSteps;
        buffers.sampleArc(i, su, buffers.scratchSample);
        const writeIdx = buffers.trailHead[i];
        const off = baseSlot + writeIdx * 3;
        buffers.trailCoords[off] = buffers.scratchSample[0];
        buffers.trailCoords[off + 1] = buffers.scratchSample[1];
        buffers.trailCoords[off + 2] = buffers.scratchSample[2];
        buffers.trailHead[i] = (writeIdx + 1) % TRAIL_POINTS;
        if (buffers.trailCount[i] < TRAIL_POINTS) {
          buffers.trailCount[i] += 1;
        }
      }
      buffers.trailLastU[i] = u;
    }
  }
}

import { useMemo } from 'react';
import { formatActionLabel } from '../engine/index.js';
import type {
  ClosureSpec,
  FlightNetworkDataset,
  Objective,
  RecoveryAction,
  RecoveryRecommendation,
  SimulationResult,
} from '../engine/types.js';

interface OperationalSummaryBoxProps {
  dataset: FlightNetworkDataset;
  closure: ClosureSpec | null;
  simulation: SimulationResult;
  appliedActions: readonly RecoveryAction[];
  objective: Objective;
  recommendations: readonly RecoveryRecommendation[];
  onSelectFlight: (flightId: string) => void;
}

const FLIGHT_ID_SPLIT_RE = /\b(DS\d{4})\b/g;

function renderTextWithFlightChips(
  text: string,
  knownFlightIds: ReadonlySet<string>,
  onSelectFlight: (flightId: string) => void,
) {
  const parts = text.split(FLIGHT_ID_SPLIT_RE);
  return parts.map((part, idx) => {
    if (knownFlightIds.has(part)) {
      return (
        <button
          key={`${part}-${idx}`}
          type="button"
          onClick={() => onSelectFlight(part)}
          aria-label={`Inspect flight ${part} domino trace`}
          className="font-mono-tabular inline-flex items-center rounded border px-1 py-0 text-[11px] font-semibold mx-0.5 cursor-pointer"
          style={{ backgroundColor: 'var(--panel-solid)', color: 'var(--storm-text)', borderColor: 'var(--storm)' }}
        >
          {part}
        </button>
      );
    }
    return <span key={`txt-${idx}`}>{part}</span>;
  });
}

/** Deterministic operational summary with clickable chips strictly matching known flight IDs. */
export function OperationalSummaryBox({
  dataset,
  closure,
  simulation,
  appliedActions,
  objective,
  recommendations,
  onSelectFlight,
}: OperationalSummaryBoxProps) {
  const knownFlightIds = useMemo(
    () => new Set(dataset.flights.map((f) => f.flight_id)),
    [dataset.flights],
  );

  const summaryLines = useMemo(() => {
    const lines: string[] = [];
    const s = simulation.summary;

    if (!closure) {
      lines.push(`Nominal operations across ${dataset.airports.length} airports (${s.totalFlights} flights).`);
    } else {
      const ap = dataset.airports.find((a) => a.id === closure.airport);
      const apLabel = ap ? `${closure.airport} (${ap.city})` : closure.airport;
      lines.push(`Ground stop at ${apLabel} ${closure.start}–${closure.end} IST: ${s.lateFlights} late flights (${s.totalDelayMin}m total delay), ${s.strandedPax} stranded pax, ${s.crewBreaches} crew breaches.`);
    }

    if (appliedActions.length > 0) {
      lines.push(`Active recovery (${appliedActions.length}): ${appliedActions.map(formatActionLabel).join('; ')}.`);
    }

    const worstFlights = simulation.flights
      .filter((f) => !f.cancelled && f.delayMin > 0)
      .sort((a, b) => b.delayMin - a.delayMin || a.flight_id.localeCompare(b.flight_id))
      .slice(0, 3);
    if (worstFlights.length > 0) {
      lines.push(
        `Top impacted legs: ${worstFlights.map((f) => `${f.flight_id} (${f.origin}→${f.destination} +${f.delayMin}m)`).join(', ')}.`,
      );
    }

    const breached = simulation.crews.filter((c) => c.breached);
    if (breached.length > 0) {
      lines.push(
        `Crew FDTL breaches: ${breached.map((c) => `${c.crewId} +${c.overageMin}m on ${c.breachedFlightIds.join(', ')}`).join('; ')}.`,
      );
    }

    if (recommendations[0]) {
      lines.push(`Top ${objective} recovery: ${recommendations[0].title}.`);
    }

    return lines;
  }, [dataset.airports, closure, simulation, appliedActions, objective, recommendations]);

  return (
    <section
      aria-label="Deterministic operational summary"
      className="surface-panel rounded-xl p-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          Operational Summary
        </h2>
        <span
          className="font-mono-tabular rounded border px-1.5 py-0.5 text-[10px]"
          style={{ borderColor: 'var(--border)', color: 'var(--spare-text)', backgroundColor: 'var(--spare-bg)' }}
        >
          DETERMINISTIC ENGINE
        </span>
      </div>

      <div className="flex flex-col gap-1.5 text-xs leading-relaxed" style={{ color: 'var(--ink)' }}>
        {summaryLines.map((line, idx) => (
          <p key={`sum-${idx}`}>{renderTextWithFlightChips(line, knownFlightIds, onSelectFlight)}</p>
        ))}
      </div>
    </section>
  );
}

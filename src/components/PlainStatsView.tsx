import type { FlightNetworkDataset, SimulationResult } from '../engine/types.js';
import { PlainStatsConnectionsTable } from './PlainStatsConnectionsTable.js';
import { PlainStatsCrewsTable } from './PlainStatsCrewsTable.js';
import { PlainStatsFlightsTable } from './PlainStatsFlightsTable.js';
import { PlainStatsSummary } from './PlainStatsSummary.js';
import { PlainStatsTimeline } from './PlainStatsTimeline.js';

interface PlainStatsViewProps {
  dataset: FlightNetworkDataset;
  baselineResult: SimulationResult;
  currentResult: SimulationResult;
  previewResult: SimulationResult | null;
  appliedCount: number;
  onSelectFlight: (flightId: string) => void;
}

/** Accessible Plain Stats operational view: Before/After, Flights, Connections, Crews, and Tail-Chain timeline. */
export function PlainStatsView({
  dataset,
  baselineResult,
  currentResult,
  previewResult,
  appliedCount,
  onSelectFlight,
}: PlainStatsViewProps) {
  const displayResult = previewResult ?? currentResult;
  const isPreview = previewResult !== null;

  const activeSpareCount = dataset.spare_aircraft.filter((sp) =>
    displayResult.flights.some((f) => !f.cancelled && f.operatingTail === sp.tail_id),
  ).length;
  const baseTailCount = new Set(dataset.flights.map((f) => f.tail_id)).size;
  const totalTimelineRows = baseTailCount + activeSpareCount;

  return (
    <div className="flex flex-col gap-4">
      <div className="surface-panel rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Plain Stats Mode
          </span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            · Accessible operational tables &amp; tail chains
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <a
            href="#section-before-after"
            aria-label="Jump to Before and After recovery summary table"
            className="surface-elevated rounded-md px-2 py-1 font-medium"
            style={{ color: 'var(--ink)' }}
          >
            Before / After
          </a>
          <a
            href="#section-flights"
            aria-label="Jump to Flights and cascade causes table"
            className="surface-elevated rounded-md px-2 py-1 font-medium"
            style={{ color: 'var(--ink)' }}
          >
            Flights ({displayResult.flights.length})
          </a>
          <a
            href="#section-connections"
            aria-label="Jump to Connections table"
            className="surface-elevated rounded-md px-2 py-1 font-medium"
            style={{ color: 'var(--ink)' }}
          >
            Connections ({displayResult.connections.length})
          </a>
          <a
            href="#section-crews"
            aria-label="Jump to Crews and 600 minute duty table"
            className="surface-elevated rounded-md px-2 py-1 font-medium"
            style={{ color: 'var(--ink)' }}
          >
            Crews ({displayResult.crews.length})
          </a>
          <a
            href="#section-tail-chains"
            aria-label="Jump to Tail-Chain CSS timeline"
            className="surface-elevated rounded-md px-2 py-1 font-medium"
            style={{ color: 'var(--ink)' }}
          >
            Tail Chains ({totalTimelineRows})
          </a>
        </div>
      </div>

      <PlainStatsSummary
        baselineResult={baselineResult}
        displayResult={displayResult}
        isPreview={isPreview}
        appliedCount={appliedCount}
      />

      <PlainStatsFlightsTable
        dataset={dataset}
        flights={displayResult.flights}
        onSelectFlight={onSelectFlight}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <PlainStatsConnectionsTable
          connections={displayResult.connections}
          onSelectFlight={onSelectFlight}
        />

        <PlainStatsCrewsTable
          crews={displayResult.crews}
          crewBreaches={displayResult.summary.crewBreaches}
          totalCrewOverageMin={displayResult.summary.totalCrewOverageMin}
          onSelectFlight={onSelectFlight}
        />
      </div>

      <PlainStatsTimeline
        dataset={dataset}
        result={displayResult}
        onSelectFlight={onSelectFlight}
      />
    </div>
  );
}

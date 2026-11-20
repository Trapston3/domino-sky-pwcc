import { useMemo, useState } from 'react';
import { formatTimeMin } from '../engine/index.js';
import type {
  ConnectionStatus,
  FlightNetworkDataset,
  FlightVisualStatus,
  SimulatedConnection,
  SimulatedCrew,
  SimulatedFlight,
  SimulationResult,
} from '../engine/types.js';

interface PlainStatsViewProps {
  dataset: FlightNetworkDataset;
  baselineResult: SimulationResult;
  currentResult: SimulationResult;
  previewResult: SimulationResult | null;
  appliedCount: number;
}

type FlightStatusFilter = 'all' | 'disrupted' | FlightVisualStatus;
type ConnectionStatusFilter = 'all' | ConnectionStatus | 'held';

const FLIGHT_STATUS_META: Record<
  FlightVisualStatus,
  { icon: string; label: string; color: string; bg: string; border: string }
> = {
  on_time: {
    icon: '✓',
    label: 'On time',
    color: 'var(--ontime-text)',
    bg: 'var(--ontime-bg)',
    border: 'var(--ontime)',
  },
  minor_delay: {
    icon: '◔',
    label: 'Minor delay',
    color: 'var(--delay-text)',
    bg: 'var(--delay-bg)',
    border: 'var(--delay)',
  },
  major_delay: {
    icon: '▲',
    label: 'Major delay',
    color: 'var(--breach-text)',
    bg: 'var(--breach-bg)',
    border: 'var(--breach)',
  },
  recovered: {
    icon: '↺',
    label: 'Recovered',
    color: 'var(--spare-text)',
    bg: 'var(--spare-bg)',
    border: 'var(--spare)',
  },
  cancelled: {
    icon: '✕',
    label: 'Cancelled',
    color: 'var(--muted)',
    bg: 'var(--panel-elevated)',
    border: 'var(--border)',
  },
};

function formatSignedNumber(delta: number, unit = ''): { text: string; color: string } {
  if (delta === 0) return { text: `0${unit}`, color: 'var(--muted)' };
  if (delta < 0) return { text: `↓ ${delta}${unit}`, color: 'var(--spare-text)' };
  return { text: `↑ +${delta}${unit}`, color: 'var(--breach-text)' };
}

function ConnectionStatusBadge({ conn }: { conn: SimulatedConnection }) {
  if (conn.status === 'broken') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: 'var(--breach-bg)',
          color: 'var(--breach-text)',
          borderColor: 'var(--breach)',
        }}
      >
        <span aria-hidden="true">✕</span>
        <span>Broken</span>
      </span>
    );
  }
  if (conn.status === 'cancelled') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: 'var(--panel-elevated)',
          color: 'var(--muted)',
          borderColor: 'var(--border)',
        }}
      >
        <span aria-hidden="true">—</span>
        <span>Cancelled</span>
      </span>
    );
  }
  if (conn.held) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: 'var(--spare-bg)',
          color: 'var(--spare-text)',
          borderColor: 'var(--spare)',
        }}
      >
        <span aria-hidden="true">⚑</span>
        <span>Held · Made</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: 'var(--ontime-bg)',
        color: 'var(--ontime-text)',
        borderColor: 'var(--ontime)',
      }}
    >
      <span aria-hidden="true">✓</span>
      <span>Made</span>
    </span>
  );
}

function CrewStatusBadge({ crew }: { crew: SimulatedCrew }) {
  if (crew.operatedFlightIds.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: 'var(--panel-elevated)',
          color: 'var(--muted)',
          borderColor: 'var(--border)',
        }}
      >
        <span aria-hidden="true">—</span>
        <span>Relieved</span>
      </span>
    );
  }
  if (crew.breached) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: 'var(--breach-bg)',
          color: 'var(--breach-text)',
          borderColor: 'var(--breach)',
        }}
      >
        <span aria-hidden="true">▲</span>
        <span>Breach +{crew.overageMin}m</span>
      </span>
    );
  }
  if (crew.maxDutyMins - crew.dutyMin <= 30) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
        style={{
          backgroundColor: 'var(--delay-bg)',
          color: 'var(--delay-text)',
          borderColor: 'var(--delay)',
        }}
      >
        <span aria-hidden="true">◔</span>
        <span>Near limit</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: 'var(--ontime-bg)',
        color: 'var(--ontime-text)',
        borderColor: 'var(--ontime)',
      }}
    >
      <span aria-hidden="true">✓</span>
      <span>Legal</span>
    </span>
  );
}

export function PlainStatsView({
  dataset,
  baselineResult,
  currentResult,
  previewResult,
  appliedCount,
}: PlainStatsViewProps) {
  const displayResult = previewResult ?? currentResult;
  const isPreview = previewResult !== null;

  const [statusFilter, setStatusFilter] = useState<FlightStatusFilter>('all');
  const [airportFilter, setAirportFilter] = useState<string>('');
  const [tailFilter, setTailFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [connFilter, setConnFilter] = useState<ConnectionStatusFilter>('all');
  const [selectedTimelineFlightId, setSelectedTimelineFlightId] = useState<string | null>(null);

  const uniqueTails = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const f of dataset.flights) {
      if (!seen.has(f.tail_id)) {
        seen.add(f.tail_id);
        list.push(f.tail_id);
      }
    }
    for (const sp of dataset.spare_aircraft) {
      if (!seen.has(sp.tail_id)) {
        seen.add(sp.tail_id);
        list.push(sp.tail_id);
      }
    }
    return list;
  }, [dataset]);

  const flightStatusCounts = useMemo(() => {
    const counts = {
      all: displayResult.flights.length,
      disrupted: 0,
      on_time: 0,
      minor_delay: 0,
      major_delay: 0,
      recovered: 0,
      cancelled: 0,
    };
    for (const f of displayResult.flights) {
      counts[f.status] += 1;
      if (f.delayMin > 0 || f.cancelled || f.crewBreachLeg) {
        counts.disrupted += 1;
      }
    }
    return counts;
  }, [displayResult.flights]);

  const filteredFlights = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return displayResult.flights.filter((f) => {
      if (statusFilter === 'disrupted') {
        if (f.delayMin === 0 && !f.cancelled && !f.crewBreachLeg) return false;
      } else if (statusFilter !== 'all' && f.status !== statusFilter) {
        return false;
      }

      if (airportFilter && f.origin !== airportFilter && f.destination !== airportFilter) {
        return false;
      }

      if (tailFilter && f.operatingTail !== tailFilter && f.tail_id !== tailFilter) {
        return false;
      }

      if (q) {
        const hay = [
          f.flight_id,
          f.origin,
          f.destination,
          f.operatingTail,
          f.tail_id,
          f.crewId,
          f.causeSummary,
          ...f.causeSteps,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [displayResult.flights, statusFilter, airportFilter, tailFilter, searchQuery]);

  const connectionCounts = useMemo(() => {
    const counts = { all: displayResult.connections.length, broken: 0, held: 0, made: 0, cancelled: 0 };
    for (const c of displayResult.connections) {
      counts[c.status] += 1;
      if (c.held) counts.held += 1;
    }
    return counts;
  }, [displayResult.connections]);

  const filteredConnections = useMemo(() => {
    return displayResult.connections.filter((c) => {
      if (connFilter === 'all') return true;
      if (connFilter === 'held') return c.held;
      return c.status === connFilter;
    });
  }, [displayResult.connections, connFilter]);

  const maxCrewDutyScale = useMemo(() => {
    const maxObserved = displayResult.crews.reduce((max, c) => Math.max(max, c.dutyMin, c.maxDutyMins), 600);
    return Math.max(660, Math.ceil(maxObserved / 60) * 60);
  }, [displayResult.crews]);

  const timelineData = useMemo(() => {
    const spareIds = new Set(dataset.spare_aircraft.map((s) => s.tail_id));
    const baseTails: string[] = [];
    const seenBase = new Set<string>();
    for (const f of dataset.flights) {
      if (!seenBase.has(f.tail_id)) {
        seenBase.add(f.tail_id);
        baseTails.push(f.tail_id);
      }
    }

    const activeSpares = dataset.spare_aircraft.filter((sp) =>
      displayResult.flights.some((f) => !f.cancelled && f.operatingTail === sp.tail_id),
    );
    const inactiveSpares = dataset.spare_aircraft.filter(
      (sp) => !activeSpares.some((a) => a.tail_id === sp.tail_id),
    );

    const allRows = [
      ...baseTails.map((id) => ({ tailId: id, isSpare: false })),
      ...activeSpares.map((sp) => ({ tailId: sp.tail_id, isSpare: true })),
    ];

    let maxArr = 23 * 60 + 30; // 23:30 baseline span
    for (const f of displayResult.flights) {
      maxArr = Math.max(maxArr, f.cancelled ? f.schedArrMin : f.actualArrMin);
    }
    const timelineStart = 5 * 60; // 05:00
    const timelineEnd = Math.ceil((maxArr + 15) / 60) * 60;
    const totalSpan = timelineEnd - timelineStart;

    const hourTicks: number[] = [];
    for (let t = 6 * 60; t <= timelineEnd; t += 120) {
      hourTicks.push(t);
    }

    const flightsByRow = new Map<
      string,
      { operatedOrCancelled: SimulatedFlight[]; handedOff: SimulatedFlight[] }
    >();
    for (const row of allRows) {
      flightsByRow.set(row.tailId, { operatedOrCancelled: [], handedOff: [] });
    }
    for (const f of displayResult.flights) {
      if (f.cancelled) {
        flightsByRow.get(f.tail_id)?.operatedOrCancelled.push(f);
      } else {
        flightsByRow.get(f.operatingTail)?.operatedOrCancelled.push(f);
        if (f.operatingTail !== f.tail_id) {
          flightsByRow.get(f.tail_id)?.handedOff.push(f);
        }
      }
    }

    for (const entry of flightsByRow.values()) {
      entry.operatedOrCancelled.sort((a, b) => a.leg_order - b.leg_order);
      entry.handedOff.sort((a, b) => a.leg_order - b.leg_order);
    }

    return {
      spareIds,
      allRows,
      inactiveSpares,
      timelineStart,
      timelineEnd,
      totalSpan,
      hourTicks,
      flightsByRow,
    };
  }, [dataset, displayResult.flights]);

  const selectedTimelineFlight = useMemo(
    () => displayResult.flights.find((f) => f.flight_id === selectedTimelineFlightId) ?? null,
    [displayResult.flights, selectedTimelineFlightId],
  );

  const hasActiveFlightFilters =
    statusFilter !== 'all' || airportFilter !== '' || tailFilter !== '' || searchQuery.trim() !== '';

  const before = baselineResult.summary;
  const after = displayResult.summary;
  const beforeAfterRows = [
    {
      label: 'Flights late',
      before: `${before.lateFlights} / ${before.totalFlights}`,
      after: `${after.lateFlights} / ${after.totalFlights}`,
      delta: after.lateFlights - before.lateFlights,
      unit: '',
    },
    {
      label: 'Flights cancelled',
      before: `${before.cancelledFlights}`,
      after: `${after.cancelledFlights}`,
      delta: after.cancelledFlights - before.cancelledFlights,
      unit: '',
    },
    {
      label: 'Total delay',
      before: `${before.totalDelayMin}m`,
      after: `${after.totalDelayMin}m`,
      delta: after.totalDelayMin - before.totalDelayMin,
      unit: 'm',
    },
    {
      label: 'Broken connections',
      before: `${before.brokenConnections}`,
      after: `${after.brokenConnections}`,
      delta: after.brokenConnections - before.brokenConnections,
      unit: '',
    },
    {
      label: 'Passengers stranded (missed conn + cancelled)',
      before: `${before.strandedPax} (${before.missedConnectionPax} + ${before.cancelledPax})`,
      after: `${after.strandedPax} (${after.missedConnectionPax} + ${after.cancelledPax})`,
      delta: after.strandedPax - before.strandedPax,
      unit: '',
    },
    {
      label: 'Crew-breach at-risk pax',
      before: `${before.crewBreachAtRiskPax}`,
      after: `${after.crewBreachAtRiskPax}`,
      delta: after.crewBreachAtRiskPax - before.crewBreachAtRiskPax,
      unit: '',
    },
    {
      label: 'Crews over 600m duty',
      before: `${before.crewBreaches} (+${before.totalCrewOverageMin}m)`,
      after: `${after.crewBreaches} (+${after.totalCrewOverageMin}m)`,
      delta: after.crewBreaches - before.crewBreaches,
      unit: '',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Quick Jump Bar */}
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
            Tail Chains ({timelineData.allRows.length})
          </a>
        </div>
      </div>

      {/* 1. Before / After KPI Summary Table */}
      <section id="section-before-after" aria-label="Before and after recovery KPI summary" className="surface-panel rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Before / After Recovery Summary
          </h2>
          <span className="font-mono-tabular text-xs" style={{ color: 'var(--muted)' }}>
            {isPreview
              ? 'Showing previewed plan vs unrecovered baseline'
              : appliedCount > 0
                ? `${appliedCount} action${appliedCount === 1 ? '' : 's'} applied vs unrecovered baseline`
                : 'Unrecovered baseline (apply a recommendation to compare)'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <caption className="sr-only">
              Before and after recovery key performance metrics comparing baseline disruption against current recovery state
            </caption>
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Metric
                </th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">
                  Before recovery
                </th>
                <th scope="col" className="py-2 px-3 font-semibold text-right">
                  {isPreview ? 'After recovery (preview)' : 'After recovery'}
                </th>
                <th scope="col" className="py-2 pl-3 font-semibold text-right">
                  Net change
                </th>
              </tr>
            </thead>
            <tbody>
              {beforeAfterRows.map((row) => {
                const deltaDisplay = formatSignedNumber(row.delta, row.unit);
                return (
                  <tr
                    key={row.label}
                    className="border-b last:border-b-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <th scope="row" className="py-2 pr-3 font-medium" style={{ color: 'var(--ink)' }}>
                      {row.label}
                    </th>
                    <td className="py-2 px-3 text-right font-mono-tabular" style={{ color: 'var(--muted)' }}>
                      {row.before}
                    </td>
                    <td className="py-2 px-3 text-right font-mono-tabular font-semibold" style={{ color: 'var(--ink)' }}>
                      {row.after}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono-tabular font-semibold" style={{ color: deltaDisplay.color }}>
                      {deltaDisplay.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Filterable Flights Table */}
      <section id="section-flights" aria-label="Filterable flights schedule and causal cascade" className="surface-panel rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Flights &amp; Cascade Causes
          </h2>
          <span className="font-mono-tabular text-xs" style={{ color: 'var(--muted)' }}>
            Showing {filteredFlights.length} of {displayResult.flights.length} flights
          </span>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Filter flights by status" className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', `All (${flightStatusCounts.all})`],
                ['disrupted', `Late / Cancelled (${flightStatusCounts.disrupted})`],
                ['on_time', `On time (${flightStatusCounts.on_time})`],
                ['minor_delay', `Minor (${flightStatusCounts.minor_delay})`],
                ['major_delay', `Major (${flightStatusCounts.major_delay})`],
                ['recovered', `Recovered (${flightStatusCounts.recovered})`],
                ['cancelled', `Cancelled (${flightStatusCounts.cancelled})`],
              ] as const
            ).map(([key, label]) => {
              const active = statusFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  aria-pressed={active}
                  aria-label={`Filter flights: ${label}`}
                  className="font-mono-tabular rounded-md border px-2 py-1 text-xs cursor-pointer"
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--pill-active-bg)',
                          color: 'var(--pill-active-ink)',
                          borderColor: 'var(--pill-active-bg)',
                        }
                      : {
                          backgroundColor: 'var(--panel-elevated)',
                          color: 'var(--ink)',
                          borderColor: 'var(--border)',
                        }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--muted)' }}>Airport</span>
              <select
                value={airportFilter}
                onChange={(e) => setAirportFilter(e.target.value)}
                aria-label="Filter flights by airport"
                className="font-mono-tabular rounded-md border px-2 py-1 text-xs"
                style={{
                  backgroundColor: 'var(--panel-elevated)',
                  color: 'var(--ink)',
                  borderColor: 'var(--border)',
                }}
              >
                <option value="">All airports</option>
                {dataset.airports.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id} · {a.city}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--muted)' }}>Tail</span>
              <select
                value={tailFilter}
                onChange={(e) => setTailFilter(e.target.value)}
                aria-label="Filter flights by aircraft tail"
                className="font-mono-tabular rounded-md border px-2 py-1 text-xs"
                style={{
                  backgroundColor: 'var(--panel-elevated)',
                  color: 'var(--ink)',
                  borderColor: 'var(--border)',
                }}
              >
                <option value="">All tails</option>
                {uniqueTails.map((tailId) => (
                  <option key={tailId} value={tailId}>
                    {tailId}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs flex-1 min-w-[180px]">
              <span className="sr-only">Search flights</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search flight ID, route, crew, cause..."
                aria-label="Search flights by flight ID, airport, tail, crew, or delay cause"
                className="w-full rounded-md border px-2.5 py-1 text-xs"
                style={{
                  backgroundColor: 'var(--panel-elevated)',
                  color: 'var(--ink)',
                  borderColor: 'var(--border)',
                }}
              />
            </label>

            {hasActiveFlightFilters && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setAirportFilter('');
                  setTailFilter('');
                  setSearchQuery('');
                }}
                aria-label="Reset all flight table filters"
                className="surface-elevated rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer"
                style={{ color: 'var(--ink)' }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto max-h-[460px] overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-left border-collapse text-xs">
            <caption className="sr-only">
              Simulated flight schedule showing scheduled vs actual times, delay, crew duty status, and causal steps explaining why each flight is late
            </caption>
            <thead
              className="sticky top-0 z-10 border-b"
              style={{ backgroundColor: 'var(--panel-solid)', borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              <tr>
                <th scope="col" className="py-2 px-2.5 font-semibold">
                  Flight
                </th>
                <th scope="col" className="py-2 px-2.5 font-semibold">
                  Tail
                </th>
                <th scope="col" className="py-2 px-2.5 font-semibold">
                  Route
                </th>
                <th scope="col" className="py-2 px-2.5 font-semibold">
                  Sched
                </th>
                <th scope="col" className="py-2 px-2.5 font-semibold">
                  Actual
                </th>
                <th scope="col" className="py-2 px-2.5 font-semibold text-right">
                  Delay
                </th>
                <th scope="col" className="py-2 px-2.5 font-semibold">
                  Status
                </th>
                <th scope="col" className="py-2 px-2.5 font-semibold">
                  Crew
                </th>
                <th scope="col" className="py-2 px-2.5 font-semibold min-w-[240px]">
                  Why late?
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredFlights.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 px-3 text-center text-xs" style={{ color: 'var(--muted)' }}>
                    No flights match the current filters.
                  </td>
                </tr>
              ) : (
                filteredFlights.map((flight) => {
                  const tone = FLIGHT_STATUS_META[flight.status];
                  return (
                    <tr
                      key={flight.flight_id}
                      className="border-b last:border-b-0 align-top"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <th scope="row" className="py-2 px-2.5 font-mono-tabular font-semibold whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                        <div>{flight.flight_id}</div>
                        <div className="text-[11px] font-normal" style={{ color: 'var(--muted)' }}>
                          {flight.pax} pax
                        </div>
                      </th>
                      <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                        <div>{flight.operatingTail}</div>
                        {flight.isSwapped && (
                          <div className="text-[11px]" style={{ color: 'var(--spare-text)' }}>
                            was {flight.tail_id}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                        {flight.origin} → {flight.destination}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                        {flight.dep}–{flight.arr}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                        {flight.cancelled ? 'Cancelled' : `${flight.actualDepStr}–${flight.actualArrStr}`}
                      </td>
                      <td
                        className="py-2 px-2.5 font-mono-tabular text-right whitespace-nowrap font-semibold"
                        style={{
                          color: flight.cancelled
                            ? 'var(--muted)'
                            : flight.delayMin > 0
                              ? tone.color
                              : 'var(--ontime-text)',
                        }}
                      >
                        {flight.cancelled ? '—' : flight.delayMin > 0 ? `+${flight.delayMin}m` : '0m'}
                      </td>
                      <td className="py-2 px-2.5 whitespace-nowrap">
                        <span
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            backgroundColor: tone.bg,
                            color: tone.color,
                            borderColor: tone.border,
                          }}
                        >
                          <span aria-hidden="true">{tone.icon}</span>
                          <span>{tone.label}</span>
                        </span>
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap">
                        <div style={{ color: flight.crewBreachLeg ? 'var(--breach-text)' : 'var(--ink)' }}>
                          {flight.crewId}
                        </div>
                        {flight.crewBreachLeg && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: 'var(--breach-bg)', color: 'var(--breach-text)' }}
                          >
                            ▲ BREACH
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2.5">
                        {flight.causeSteps.length > 0 ? (
                          <ol className="flex flex-col gap-0.5">
                            {flight.causeSteps.map((step, i) => (
                              <li key={`${flight.flight_id}-cause-${i}`} style={{ color: 'var(--ink)' }}>
                                {flight.causeSteps.length > 1 ? `${i + 1}. ` : ''}
                                {step}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>
                            {flight.cancelled ? 'Cancelled by recovery action' : 'On schedule'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Connections & 4. Crews side-by-side on wide screens or stacked */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Connections Table */}
        <section id="section-connections" aria-label="Passenger connections table" className="surface-panel rounded-xl p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Connections ({filteredConnections.length}/{displayResult.connections.length})
            </h2>
            <div role="group" aria-label="Filter connections by status" className="flex flex-wrap gap-1">
              {(
                [
                  ['all', `All (${connectionCounts.all})`],
                  ['broken', `Broken (${connectionCounts.broken})`],
                  ['held', `Held (${connectionCounts.held})`],
                  ['made', `Made (${connectionCounts.made})`],
                  ['cancelled', `Canc (${connectionCounts.cancelled})`],
                ] as const
              ).map(([key, label]) => {
                const active = connFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setConnFilter(key)}
                    aria-pressed={active}
                    aria-label={`Filter connections: ${label}`}
                    className="font-mono-tabular rounded border px-2 py-0.5 text-[11px] cursor-pointer"
                    style={
                      active
                        ? {
                            backgroundColor: 'var(--pill-active-bg)',
                            color: 'var(--pill-active-ink)',
                            borderColor: 'var(--pill-active-bg)',
                          }
                        : {
                            backgroundColor: 'var(--panel-elevated)',
                            color: 'var(--ink)',
                            borderColor: 'var(--border)',
                          }
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[380px] overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-left border-collapse text-xs">
              <caption className="sr-only">
                Passenger connections across hubs showing minimum connect time, margin or shortfall, and connection status
              </caption>
              <thead
                className="sticky top-0 z-10 border-b"
                style={{ backgroundColor: 'var(--panel-solid)', borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                <tr>
                  <th scope="col" className="py-2 px-2.5 font-semibold">
                    Conn
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold">
                    Hub
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold">
                    From → To
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold text-right">
                    Pax
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold text-right">
                    Min
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold text-right">
                    Margin
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredConnections.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 px-3 text-center" style={{ color: 'var(--muted)' }}>
                      No connections match this filter.
                    </td>
                  </tr>
                ) : (
                  filteredConnections.map((conn) => (
                    <tr
                      key={conn.connection_id}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <th scope="row" className="py-2 px-2.5 font-mono-tabular font-semibold" style={{ color: 'var(--ink)' }}>
                        {conn.connection_id}
                      </th>
                      <td className="py-2 px-2.5 font-mono-tabular" style={{ color: 'var(--ink)' }}>
                        {conn.airport}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                        {conn.from_flight} → {conn.to_flight}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular text-right" style={{ color: 'var(--ink)' }}>
                        {conn.passengers}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular text-right" style={{ color: 'var(--muted)' }}>
                        {conn.min_connect_minutes}m
                      </td>
                      <td
                        className="py-2 px-2.5 font-mono-tabular text-right font-semibold whitespace-nowrap"
                        style={{
                          color:
                            conn.status === 'broken'
                              ? 'var(--breach-text)'
                              : conn.status === 'cancelled'
                                ? 'var(--muted)'
                                : 'var(--ontime-text)',
                        }}
                      >
                        {conn.status === 'broken'
                          ? `-${conn.shortfallMin}m`
                          : conn.status === 'cancelled'
                            ? '—'
                            : `+${conn.slackMin}m`}
                      </td>
                      <td className="py-2 px-2.5 whitespace-nowrap">
                        <ConnectionStatusBadge conn={conn} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Crews Table with 600m duty progress bar */}
        <section id="section-crews" aria-label="Crew FDTL duty table" className="surface-panel rounded-xl p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Crews &amp; 600m Duty Limit ({displayResult.crews.length})
            </h2>
            <span className="font-mono-tabular text-xs" style={{ color: 'var(--muted)' }}>
              {displayResult.summary.crewBreaches} breached · {displayResult.summary.totalCrewOverageMin}m overage
            </span>
          </div>

          <div className="overflow-x-auto max-h-[380px] overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-left border-collapse text-xs">
              <caption className="sr-only">
                Crew duty hours measured from duty start to actual arrival of final operated leg against 600-minute maximum duty limit
              </caption>
              <thead
                className="sticky top-0 z-10 border-b"
                style={{ backgroundColor: 'var(--panel-solid)', borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                <tr>
                  <th scope="col" className="py-2 px-2.5 font-semibold">
                    Crew
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold">
                    Tail / Base
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold">
                    Window
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold min-w-[160px]">
                    600m Duty Bar
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="py-2 px-2.5 font-semibold">
                    Legs
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayResult.crews.map((crew) => {
                  const isIdle = crew.operatedFlightIds.length === 0;
                  const fillPct = isIdle ? 0 : Math.min(100, (crew.dutyMin / maxCrewDutyScale) * 100);
                  const limitPct = Math.min(100, (crew.maxDutyMins / maxCrewDutyScale) * 100);
                  const barColor = crew.breached
                    ? 'var(--breach)'
                    : crew.maxDutyMins - crew.dutyMin <= 30
                      ? 'var(--delay)'
                      : 'var(--spare)';

                  return (
                    <tr
                      key={crew.crewId}
                      className="border-b last:border-b-0 align-top"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <th scope="row" className="py-2 px-2.5 font-mono-tabular font-semibold whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                        <div>{crew.crewId}</div>
                        {crew.isStandby && (
                          <span
                            className="inline-block rounded px-1 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: 'var(--spare-bg)', color: 'var(--spare-text)' }}
                          >
                            Standby
                          </span>
                        )}
                      </th>
                      <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                        {crew.tailId} · {crew.base}
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                        {isIdle ? `${crew.dutyStartStr} (0 legs)` : `${crew.dutyStartStr}–${crew.lastArrStr}`}
                      </td>
                      <td className="py-2 px-2.5">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between font-mono-tabular text-[11px]">
                            <span style={{ color: crew.breached ? 'var(--breach-text)' : 'var(--ink)' }}>
                              {isIdle ? '0m' : `${crew.dutyMin}m`}
                            </span>
                            <span style={{ color: 'var(--muted)' }}>/ {crew.maxDutyMins}m</span>
                          </div>
                          <div
                            role="progressbar"
                            aria-valuenow={isIdle ? 0 : crew.dutyMin}
                            aria-valuemin={0}
                            aria-valuemax={crew.maxDutyMins}
                            aria-label={`${crew.crewId} duty ${isIdle ? 0 : crew.dutyMin} of ${crew.maxDutyMins} minutes`}
                            className="relative h-2.5 w-full rounded-full overflow-hidden"
                            style={{ backgroundColor: 'var(--track-bg)' }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${fillPct}%`, backgroundColor: barColor }}
                            />
                            <div
                              aria-hidden="true"
                              className="absolute top-0 bottom-0 w-0.5"
                              style={{ left: `${limitPct}%`, backgroundColor: 'var(--ink)' }}
                              title={`Max duty ${crew.maxDutyMins}m`}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-2.5 whitespace-nowrap">
                        <CrewStatusBadge crew={crew} />
                      </td>
                      <td className="py-2 px-2.5 font-mono-tabular text-[11px]">
                        {isIdle ? (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {crew.operatedFlightIds.map((fid) => {
                              const isBreachLeg = crew.breachedFlightIds.includes(fid);
                              return (
                                <span
                                  key={`${crew.crewId}-${fid}`}
                                  className="rounded px-1 py-0.5"
                                  style={
                                    isBreachLeg
                                      ? { backgroundColor: 'var(--breach-bg)', color: 'var(--breach-text)', fontWeight: 600 }
                                      : { backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)' }
                                  }
                                >
                                  {isBreachLeg ? `! ${fid}` : fid}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* 5. Tail-Chain CSS Timeline across all tails (including active spares) */}
      <section id="section-tail-chains" aria-label="Tail chain operational timeline" className="surface-panel rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Tail-Chain CSS Timeline ({timelineData.allRows.length} tails)
            </h2>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Dashed outlines mark original scheduled slot on delayed/swapped legs. Activate any leg to inspect causeSteps.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {(
              [
                ['on_time', '✓ On time'],
                ['minor_delay', '◔ Minor delay'],
                ['major_delay', '▲ Major delay'],
                ['recovered', '↺ Recovered / Spare'],
                ['cancelled', '✕ Cancelled'],
              ] as const
            ).map(([statusKey, text]) => {
              const meta = FLIGHT_STATUS_META[statusKey];
              return (
                <span
                  key={statusKey}
                  className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5"
                  style={{ backgroundColor: meta.bg, borderColor: meta.border, color: meta.color }}
                >
                  {text}
                </span>
              );
            })}
          </div>
        </div>

        {timelineData.inactiveSpares.length > 0 && (
          <p className="font-mono-tabular text-xs" style={{ color: 'var(--muted)' }}>
            Standby spares on ground:{' '}
            {timelineData.inactiveSpares
              .map((s) => `${s.tail_id} (${s.base} from ${s.available_from})`)
              .join(' · ')}
          </p>
        )}

        <div className="overflow-x-auto rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel-solid)' }}>
          <div className="min-w-[760px] flex flex-col gap-1.5">
            {/* Hour Axis */}
            <div className="flex items-center gap-2 pb-1 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="w-28 shrink-0 font-mono-tabular text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
                Tail
              </div>
              <div className="relative flex-1 h-5">
                {timelineData.hourTicks.map((tickMin) => {
                  const leftPct = ((tickMin - timelineData.timelineStart) / timelineData.totalSpan) * 100;
                  return (
                    <span
                      key={tickMin}
                      className="font-mono-tabular absolute -translate-x-1/2 text-[10px]"
                      style={{ left: `${leftPct}%`, color: 'var(--muted)' }}
                    >
                      {formatTimeMin(tickMin)}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Rows */}
            <div className="relative flex flex-col gap-1.5">
              {displayResult.closure && (() => {
                const cStart = Math.max(
                  timelineData.timelineStart,
                  Math.min(timelineData.timelineEnd, displayResult.closure.startMin),
                );
                const cEnd = Math.max(
                  cStart,
                  Math.min(timelineData.timelineEnd, displayResult.closure.endMin),
                );
                if (cEnd <= cStart) return null;
                const leftPct = ((cStart - timelineData.timelineStart) / timelineData.totalSpan) * 100;
                const widthPct = ((cEnd - cStart) / timelineData.totalSpan) * 100;
                return (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 bottom-0 left-30 right-0 z-0"
                  >
                    <div
                      className="absolute top-0 bottom-0 border-x border-dashed"
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        backgroundColor: 'var(--storm-bg)',
                        borderColor: 'var(--storm)',
                      }}
                    >
                      <span
                        className="font-mono-tabular inline-block whitespace-nowrap rounded-b px-1 py-0.5 text-[9px] font-semibold"
                        style={{ backgroundColor: 'var(--storm)', color: 'var(--bg)' }}
                      >
                        ⚡ {displayResult.closure.airport} CLOSED
                      </span>
                    </div>
                  </div>
                );
              })()}

              {timelineData.allRows.map((row) => {
                const rowData = timelineData.flightsByRow.get(row.tailId);
                const legs = rowData?.operatedOrCancelled ?? [];
                const handedOff = rowData?.handedOff ?? [];

                return (
                  <div
                    key={row.tailId}
                    className="flex items-center gap-2"
                  >
                    <div className="w-28 shrink-0 flex flex-col">
                      <span
                        className="font-mono-tabular text-xs font-semibold"
                        style={{ color: row.isSpare ? 'var(--spare-text)' : 'var(--ink)' }}
                      >
                        {row.isSpare ? `↺ ${row.tailId}` : row.tailId}
                      </span>
                      <span className="font-mono-tabular text-[10px]" style={{ color: 'var(--muted)' }}>
                        {row.isSpare ? 'Active spare' : `${legs.filter((l) => !l.cancelled).length} operated`}
                      </span>
                    </div>

                    <div
                      className="relative flex-1 h-9 rounded-md border overflow-hidden"
                      style={{ backgroundColor: 'var(--track-bg)', borderColor: 'var(--border)' }}
                    >
                      {/* Vertical hour gridlines */}
                      {timelineData.hourTicks.map((tickMin) => {
                        const leftPct = ((tickMin - timelineData.timelineStart) / timelineData.totalSpan) * 100;
                        return (
                          <div
                            key={`${row.tailId}-grid-${tickMin}`}
                            aria-hidden="true"
                            className="absolute top-0 bottom-0 w-px opacity-35"
                            style={{ left: `${leftPct}%`, backgroundColor: 'var(--border)' }}
                          />
                        );
                      })}

                      {/* Handed-off legs indicator (moved to spare) */}
                      {handedOff.map((f) => {
                        const leftPct = ((f.schedDepMin - timelineData.timelineStart) / timelineData.totalSpan) * 100;
                        const widthPct = Math.max(2, ((f.schedArrMin - f.schedDepMin) / timelineData.totalSpan) * 100);
                        return (
                          <div
                            key={`${f.flight_id}-handoff`}
                            aria-hidden="true"
                            title={`${f.flight_id} transferred to ${f.operatingTail}`}
                            className="font-mono-tabular absolute top-1.5 bottom-1.5 rounded border border-dashed flex items-center justify-center text-[10px] opacity-75 px-1 truncate"
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              borderColor: 'var(--spare)',
                              color: 'var(--spare-text)',
                            }}
                          >
                            → {f.operatingTail}
                          </div>
                        );
                      })}

                      {/* Scheduled ghost blocks for delayed operated flights */}
                      {legs.map((f) => {
                        if (f.cancelled || f.delayMin <= 0) return null;
                        const ghostLeft = ((f.schedDepMin - timelineData.timelineStart) / timelineData.totalSpan) * 100;
                        const ghostWidth = Math.max(1.5, ((f.schedArrMin - f.schedDepMin) / timelineData.totalSpan) * 100);
                        return (
                          <div
                            key={`${f.flight_id}-ghost`}
                            aria-hidden="true"
                            className="absolute top-2 bottom-2 rounded border border-dashed opacity-45"
                            style={{
                              left: `${ghostLeft}%`,
                              width: `${ghostWidth}%`,
                              borderColor: 'var(--muted)',
                            }}
                          />
                        );
                      })}

                      {/* Actual / Cancelled Flight Blocks */}
                      {legs.map((f) => {
                        const startMin = f.cancelled ? f.schedDepMin : f.actualDepMin;
                        const endMin = f.cancelled ? f.schedArrMin : f.actualArrMin;
                        const leftPct = ((startMin - timelineData.timelineStart) / timelineData.totalSpan) * 100;
                        const widthPct = Math.max(2.2, ((endMin - startMin) / timelineData.totalSpan) * 100);
                        const meta = FLIGHT_STATUS_META[f.status];
                        const isSelected = selectedTimelineFlightId === f.flight_id;

                        return (
                          <button
                            key={f.flight_id}
                            type="button"
                            onClick={() =>
                              setSelectedTimelineFlightId((prev) =>
                                prev === f.flight_id ? null : f.flight_id,
                              )
                            }
                            aria-pressed={isSelected}
                            aria-label={`${f.flight_id} ${f.origin} to ${f.destination}, ${
                              f.cancelled
                                ? 'cancelled'
                                : `actual ${f.actualDepStr} to ${f.actualArrStr}, delay +${f.delayMin}m`
                            }${f.crewBreachLeg ? ', crew duty breach' : ''}`}
                            title={`${f.flight_id} ${f.origin}→${f.destination} · ${
                              f.cancelled ? 'Cancelled' : `${f.actualDepStr}–${f.actualArrStr} (+${f.delayMin}m)`
                            }`}
                            className="font-mono-tabular absolute top-1 bottom-1 rounded border px-1 flex items-center justify-between gap-0.5 text-[10px] font-medium overflow-hidden cursor-pointer"
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              backgroundColor: isSelected ? 'var(--pill-active-bg)' : meta.bg,
                              color: isSelected ? 'var(--pill-active-ink)' : meta.color,
                              borderColor: f.crewBreachLeg ? 'var(--breach)' : meta.border,
                              borderStyle: f.cancelled ? 'dashed' : 'solid',
                              borderWidth: f.crewBreachLeg || isSelected ? '2px' : '1px',
                              textDecoration: f.cancelled ? 'line-through' : 'none',
                            }}
                          >
                            <span className="truncate">
                              {meta.icon} {f.flight_id.replace('DS', '')}
                            </span>
                            {f.crewBreachLeg && <span aria-hidden="true">!</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Timeline Leg Inspector */}
        {selectedTimelineFlight && (
          <div
            className="surface-elevated rounded-lg p-3 flex flex-col gap-1.5 text-xs"
            aria-label={`Selected leg details for ${selectedTimelineFlight.flight_id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono-tabular font-semibold" style={{ color: 'var(--ink)' }}>
                  {selectedTimelineFlight.flight_id} ({selectedTimelineFlight.origin} →{' '}
                  {selectedTimelineFlight.destination})
                </span>
                <span className="font-mono-tabular" style={{ color: 'var(--muted)' }}>
                  Tail {selectedTimelineFlight.operatingTail} · Crew {selectedTimelineFlight.crewId} ·{' '}
                  {selectedTimelineFlight.pax} pax
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTimelineFlightId(null)}
                aria-label="Close selected flight details"
                className="font-mono-tabular rounded px-2 py-0.5 text-xs cursor-pointer"
                style={{ color: 'var(--muted)' }}
              >
                Close ✕
              </button>
            </div>
            <div className="font-mono-tabular" style={{ color: 'var(--ink)' }}>
              Sched {selectedTimelineFlight.dep}–{selectedTimelineFlight.arr} ·{' '}
              {selectedTimelineFlight.cancelled
                ? 'Cancelled by recovery action'
                : `Actual ${selectedTimelineFlight.actualDepStr}–${selectedTimelineFlight.actualArrStr} (+${selectedTimelineFlight.delayMin}m) · Turnaround slack: ${selectedTimelineFlight.turnaroundSlackMin}m`}
            </div>
            {selectedTimelineFlight.causeSteps.length > 0 && (
              <p style={{ color: 'var(--ink)' }}>
                <strong>Why late:</strong> {selectedTimelineFlight.causeSteps.join(' → ')}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

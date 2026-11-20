import { useMemo, useState } from 'react';
import type { FlightNetworkDataset, SimulatedFlight } from '../engine/types.js';
import {
  countFlightStatuses,
  filterFlights,
  getUniqueTailIds,
  type FlightStatusFilter,
} from './flightFilters.js';
import { FLIGHT_STATUS_META } from './statusStyles.js';

interface PlainStatsFlightsTableProps {
  dataset: FlightNetworkDataset;
  flights: readonly SimulatedFlight[];
  onSelectFlight: (flightId: string) => void;
}

/** Filterable Flights schedule table with "Why late?" causal steps and Domino Trace inspection buttons. */
export function PlainStatsFlightsTable({
  dataset,
  flights,
  onSelectFlight,
}: PlainStatsFlightsTableProps) {
  const [statusFilter, setStatusFilter] = useState<FlightStatusFilter>('all');
  const [airportFilter, setAirportFilter] = useState<string>('');
  const [tailFilter, setTailFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const uniqueTails = useMemo(() => getUniqueTailIds(dataset), [dataset]);
  const statusCounts = useMemo(() => countFlightStatuses(flights), [flights]);
  const filteredFlights = useMemo(
    () => filterFlights(flights, statusFilter, airportFilter, tailFilter, searchQuery),
    [flights, statusFilter, airportFilter, tailFilter, searchQuery],
  );

  const hasFilters = statusFilter !== 'all' || airportFilter !== '' || tailFilter !== '' || searchQuery.trim() !== '';

  return (
    <section id="section-flights" aria-label="Filterable flights schedule and causal cascade" className="surface-panel rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          Flights &amp; Cascade Causes
        </h2>
        <span className="font-mono-tabular text-xs" style={{ color: 'var(--muted)' }}>
          Showing {filteredFlights.length} of {flights.length} flights
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div role="group" aria-label="Filter flights by status" className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['all', `All (${statusCounts.all})`],
              ['disrupted', `Late / Cancelled (${statusCounts.disrupted})`],
              ['on_time', `On time (${statusCounts.on_time})`],
              ['minor_delay', `Minor (${statusCounts.minor_delay})`],
              ['major_delay', `Major (${statusCounts.major_delay})`],
              ['recovered', `Recovered (${statusCounts.recovered})`],
              ['cancelled', `Cancelled (${statusCounts.cancelled})`],
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
                    ? { backgroundColor: 'var(--pill-active-bg)', color: 'var(--pill-active-ink)', borderColor: 'var(--pill-active-bg)' }
                    : { backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }
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
              style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }}
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
              style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }}
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
              style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            />
          </label>

          {hasFilters && (
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
              <th scope="col" className="py-2 px-2.5 font-semibold">Flight</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Tail</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Route</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Sched</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Actual</th>
              <th scope="col" className="py-2 px-2.5 font-semibold text-right">Delay</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Status</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Crew</th>
              <th scope="col" className="py-2 px-2.5 font-semibold min-w-[240px]">Why late?</th>
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
                  <tr key={flight.flight_id} className="border-b last:border-b-0 align-top" style={{ borderColor: 'var(--border)' }}>
                    <th scope="row" className="py-2 px-2.5 font-mono-tabular font-semibold whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                      <button
                        type="button"
                        onClick={() => onSelectFlight(flight.flight_id)}
                        aria-label={`Open Domino Trace for flight ${flight.flight_id}`}
                        className="underline cursor-pointer text-left"
                        style={{ color: 'var(--ink)' }}
                      >
                        {flight.flight_id}
                      </button>
                      <div className="text-[11px] font-normal" style={{ color: 'var(--muted)' }}>{flight.pax} pax</div>
                    </th>
                    <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                      <div>{flight.operatingTail}</div>
                      {flight.isSwapped && <div className="text-[11px]" style={{ color: 'var(--spare-text)' }}>was {flight.tail_id}</div>}
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
                      style={{ color: flight.cancelled ? 'var(--muted)' : flight.delayMin > 0 ? tone.color : 'var(--ontime-text)' }}
                    >
                      {flight.cancelled ? '—' : flight.delayMin > 0 ? `+${flight.delayMin}m` : '0m'}
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        style={{ backgroundColor: tone.bg, color: tone.color, borderColor: tone.border }}
                      >
                        <span aria-hidden="true">{tone.icon}</span>
                        <span>{tone.label}</span>
                      </span>
                    </td>
                    <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap">
                      <div style={{ color: flight.crewBreachLeg ? 'var(--breach-text)' : 'var(--ink)' }}>{flight.crewId}</div>
                      {flight.crewBreachLeg && (
                        <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: 'var(--breach-bg)', color: 'var(--breach-text)' }}>
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
  );
}

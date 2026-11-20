import { useMemo, useState } from 'react';
import type { ConnectionStatus, SimulatedConnection } from '../engine/types.js';
import { getConnectionBadgeMeta } from './statusStyles.js';

interface PlainStatsConnectionsTableProps {
  connections: readonly SimulatedConnection[];
  onSelectFlight: (flightId: string) => void;
}

type ConnectionStatusFilter = 'all' | ConnectionStatus | 'held';

/** Filterable passenger Connections table in Plain Stats mode. */
export function PlainStatsConnectionsTable({
  connections,
  onSelectFlight,
}: PlainStatsConnectionsTableProps) {
  const [connFilter, setConnFilter] = useState<ConnectionStatusFilter>('all');

  const counts = useMemo(() => {
    const c = { all: connections.length, broken: 0, held: 0, made: 0, cancelled: 0 };
    for (const item of connections) {
      c[item.status] += 1;
      if (item.held) c.held += 1;
    }
    return c;
  }, [connections]);

  const filtered = useMemo(
    () =>
      connections.filter((c) => {
        if (connFilter === 'all') return true;
        if (connFilter === 'held') return c.held;
        return c.status === connFilter;
      }),
    [connections, connFilter],
  );

  return (
    <section id="section-connections" aria-label="Passenger connections table" className="surface-panel rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          Connections ({filtered.length}/{connections.length})
        </h2>
        <div role="group" aria-label="Filter connections by status" className="flex flex-wrap gap-1">
          {(
            [
              ['all', `All (${counts.all})`],
              ['broken', `Broken (${counts.broken})`],
              ['held', `Held (${counts.held})`],
              ['made', `Made (${counts.made})`],
              ['cancelled', `Canc (${counts.cancelled})`],
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
                    ? { backgroundColor: 'var(--pill-active-bg)', color: 'var(--pill-active-ink)', borderColor: 'var(--pill-active-bg)' }
                    : { backgroundColor: 'var(--panel-elevated)', color: 'var(--ink)', borderColor: 'var(--border)' }
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
              <th scope="col" className="py-2 px-2.5 font-semibold">Conn</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Hub</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">From → To</th>
              <th scope="col" className="py-2 px-2.5 font-semibold text-right">Pax</th>
              <th scope="col" className="py-2 px-2.5 font-semibold text-right">Min</th>
              <th scope="col" className="py-2 px-2.5 font-semibold text-right">Margin</th>
              <th scope="col" className="py-2 px-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 px-3 text-center" style={{ color: 'var(--muted)' }}>
                  No connections match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((conn) => {
                const badge = getConnectionBadgeMeta(conn);
                return (
                  <tr key={conn.connection_id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
                    <th scope="row" className="py-2 px-2.5 font-mono-tabular font-semibold" style={{ color: 'var(--ink)' }}>
                      {conn.connection_id}
                    </th>
                    <td className="py-2 px-2.5 font-mono-tabular" style={{ color: 'var(--ink)' }}>
                      {conn.airport}
                    </td>
                    <td className="py-2 px-2.5 font-mono-tabular whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                      <button
                        type="button"
                        onClick={() => onSelectFlight(conn.from_flight)}
                        aria-label={`Inspect inbound flight ${conn.from_flight}`}
                        className="underline cursor-pointer"
                      >
                        {conn.from_flight}
                      </button>{' '}
                      →{' '}
                      <button
                        type="button"
                        onClick={() => onSelectFlight(conn.to_flight)}
                        aria-label={`Inspect outbound flight ${conn.to_flight}`}
                        className="underline cursor-pointer"
                      >
                        {conn.to_flight}
                      </button>
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
                        color: conn.status === 'broken' ? 'var(--breach-text)' : conn.status === 'cancelled' ? 'var(--muted)' : 'var(--ontime-text)',
                      }}
                    >
                      {conn.status === 'broken' ? `-${conn.shortfallMin}m` : conn.status === 'cancelled' ? '—' : `+${conn.slackMin}m`}
                    </td>
                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        style={{ backgroundColor: badge.bg, color: badge.color, borderColor: badge.border }}
                      >
                        <span aria-hidden="true">{badge.icon}</span>
                        <span>{conn.held && conn.status === 'made' ? 'Held · Made' : conn.status === 'broken' ? 'Broken' : conn.status === 'cancelled' ? 'Cancelled' : 'Made'}</span>
                      </span>
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

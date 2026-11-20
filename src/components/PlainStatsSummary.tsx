import type { SimulationResult } from '../engine/types.js';
import { formatSignedDelta } from './statusStyles.js';

interface PlainStatsSummaryProps {
  baselineResult: SimulationResult;
  displayResult: SimulationResult;
  isPreview: boolean;
  appliedCount: number;
}

/** Before vs After recovery KPI comparison table in Plain Stats mode. */
export function PlainStatsSummary({
  baselineResult,
  displayResult,
  isPreview,
  appliedCount,
}: PlainStatsSummaryProps) {
  const before = baselineResult.summary;
  const after = displayResult.summary;

  const rows = [
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
    <section
      id="section-before-after"
      aria-label="Before and after recovery KPI summary"
      className="surface-panel rounded-xl p-4"
    >
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
            {rows.map((row) => {
              const deltaDisplay = formatSignedDelta(row.delta, row.unit);
              return (
                <tr key={row.label} className="border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
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
  );
}

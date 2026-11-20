import type { SimulationSummary } from '../engine/types.js';

interface KpiStripProps {
  baselineSummary: SimulationSummary;
  currentSummary: SimulationSummary;
  previewSummary: SimulationSummary | null;
  previewTitle: string | null;
  appliedCount: number;
  layout?: 'wide' | 'rail';
}

function formatHoursMin(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function DeltaBadge({
  currentValue,
  previousValue,
  unit = '',
  previewMode,
}: {
  currentValue: number;
  previousValue: number | null;
  unit?: string;
  previewMode: boolean;
}) {
  if (previousValue === null) return null;
  const delta = currentValue - previousValue;
  if (delta === 0) {
    if (!previewMode) return null;
    return (
      <span
        className="font-mono-tabular inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
        style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--muted)' }}
      >
        <span>=</span>
        <span>was {previousValue}{unit}</span>
      </span>
    );
  }

  const improved = delta < 0;
  const icon = improved ? '↓' : '↑';
  const signed = delta > 0 ? `+${delta}${unit}` : `${delta}${unit}`;
  return (
    <span
      className="font-mono-tabular inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        backgroundColor: improved ? 'var(--spare-bg)' : 'var(--breach-bg)',
        color: improved ? 'var(--spare-text)' : 'var(--breach-text)',
        borderColor: improved ? 'var(--spare)' : 'var(--breach)',
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span>was {previousValue}{unit}</span>
      <span>({signed})</span>
    </span>
  );
}

/** Displays the 4 headline disruption KPIs with `was X` hover/apply deltas and pax breakdown. */
export function KpiStrip({
  baselineSummary,
  currentSummary,
  previewSummary,
  previewTitle,
  appliedCount,
  layout = 'wide',
}: KpiStripProps) {
  const isPreview = previewSummary !== null;
  const display = previewSummary ?? currentSummary;
  const compare = isPreview ? currentSummary : appliedCount > 0 ? baselineSummary : null;
  const compact = layout === 'rail';

  const lateTone =
    display.lateFlights === 0
      ? { color: 'var(--ontime-text)', icon: '✓', label: 'On schedule' }
      : display.lateFlights >= 8
        ? { color: 'var(--breach-text)', icon: '▲', label: 'Cascade active' }
        : { color: 'var(--delay-text)', icon: '◔', label: 'Localized' };

  const delayTone =
    display.totalDelayMin === 0
      ? { color: 'var(--ontime-text)', icon: '✓', label: 'Zero delay' }
      : display.totalDelayMin >= 300
        ? { color: 'var(--breach-text)', icon: '▲', label: 'Severe' }
        : { color: 'var(--delay-text)', icon: '◔', label: 'Moderate' };

  const strandedTone =
    display.strandedPax === 0
      ? { color: 'var(--ontime-text)', icon: '✓', label: 'None' }
      : display.strandedPax >= 100
        ? { color: 'var(--breach-text)', icon: '▲', label: 'High impact' }
        : { color: 'var(--delay-text)', icon: '◔', label: 'Impacted' };

  const crewTone =
    display.crewBreaches > 0
      ? { color: 'var(--breach-text)', icon: '▲', label: 'FDTL breach' }
      : { color: 'var(--ontime-text)', icon: '✓', label: 'Legal ≤600m' };

  return (
    <section aria-label="Key disruption performance indicators" className="flex flex-col gap-2">
      {(isPreview || appliedCount > 0) && (
        <div
          className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1 text-[11px]"
          style={
            isPreview
              ? { backgroundColor: 'var(--storm-bg)', borderColor: 'var(--storm)', color: 'var(--storm-text)' }
              : { backgroundColor: 'var(--spare-bg)', borderColor: 'var(--spare)', color: 'var(--spare-text)' }
          }
        >
          <span className="font-medium truncate">
            {isPreview
              ? `◎ Preview: ${previewTitle ?? 'Plan'}`
              : `✓ ${appliedCount} action${appliedCount === 1 ? '' : 's'} applied`}
          </span>
          <span className="font-mono-tabular text-[10px]">
            {isPreview ? 'vs current' : 'vs baseline'}
          </span>
        </div>
      )}

      <div className={compact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3'}>
        <article className={`surface-panel rounded-xl ${compact ? 'p-2.5' : 'p-3.5'} flex flex-col justify-between gap-1.5`}>
          <div className="flex items-center justify-between gap-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Flights late
            </h2>
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium" style={{ color: lateTone.color }}>
              <span aria-hidden="true">{lateTone.icon}</span>
              <span>{lateTone.label}</span>
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <div className="flex items-baseline gap-1.5">
              <span
                className={`font-mono-tabular ${compact ? 'text-2xl' : 'text-3xl'} font-semibold leading-none`}
                style={{ color: display.lateFlights > 0 ? lateTone.color : 'var(--ink)' }}
              >
                {display.lateFlights}
              </span>
              <span className="font-mono-tabular text-[11px]" style={{ color: 'var(--muted)' }}>
                /{display.totalFlights}
              </span>
            </div>
            <DeltaBadge currentValue={display.lateFlights} previousValue={compare ? compare.lateFlights : null} previewMode={isPreview} />
          </div>
          <p className="font-mono-tabular text-[11px]" style={{ color: 'var(--muted)' }}>
            {display.onTimeFlights} on time · {display.cancelledFlights} canc
          </p>
        </article>

        <article className={`surface-panel rounded-xl ${compact ? 'p-2.5' : 'p-3.5'} flex flex-col justify-between gap-1.5`}>
          <div className="flex items-center justify-between gap-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Delay min
            </h2>
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium" style={{ color: delayTone.color }}>
              <span aria-hidden="true">{delayTone.icon}</span>
              <span>{delayTone.label}</span>
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <div className="flex items-baseline gap-1.5">
              <span
                className={`font-mono-tabular ${compact ? 'text-2xl' : 'text-3xl'} font-semibold leading-none`}
                style={{ color: display.totalDelayMin > 0 ? delayTone.color : 'var(--ink)' }}
              >
                {display.totalDelayMin}m
              </span>
              <span className="font-mono-tabular text-[11px]" style={{ color: 'var(--muted)' }}>
                {formatHoursMin(display.totalDelayMin)}
              </span>
            </div>
            <DeltaBadge currentValue={display.totalDelayMin} previousValue={compare ? compare.totalDelayMin : null} unit="m" previewMode={isPreview} />
          </div>
          <p className="font-mono-tabular text-[11px]" style={{ color: 'var(--muted)' }}>
            {display.operatedFlights} operated legs
          </p>
        </article>

        <article className={`surface-panel rounded-xl ${compact ? 'p-2.5 col-span-2' : 'p-3.5'} flex flex-col justify-between gap-1.5`}>
          <div className="flex items-center justify-between gap-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Passengers stranded
            </h2>
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium" style={{ color: strandedTone.color }}>
              <span aria-hidden="true">{strandedTone.icon}</span>
              <span>{strandedTone.label}</span>
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <span
              className={`font-mono-tabular ${compact ? 'text-2xl' : 'text-3xl'} font-semibold leading-none`}
              style={{ color: display.strandedPax > 0 ? strandedTone.color : 'var(--ink)' }}
            >
              {display.strandedPax}
            </span>
            <DeltaBadge currentValue={display.strandedPax} previousValue={compare ? compare.strandedPax : null} previewMode={isPreview} />
          </div>
          <div className="flex flex-col gap-0.5 text-[11px]">
            <p className="font-mono-tabular" style={{ color: 'var(--muted)' }}>
              {display.missedConnectionPax} missed-conn ({display.brokenConnections} conn) + {display.cancelledPax} cancelled ({display.cancelledFlights} flt)
            </p>
            <p className="font-mono-tabular font-medium" style={{ color: display.crewBreachAtRiskPax > 0 ? 'var(--breach-text)' : 'var(--muted)' }}>
              <span aria-hidden="true">{display.crewBreachAtRiskPax > 0 ? '⚠ ' : '✓ '}</span>
              Crew-breach at-risk pax: {display.crewBreachAtRiskPax}
            </p>
          </div>
        </article>

        <article className={`surface-panel rounded-xl ${compact ? 'p-2.5 col-span-2' : 'p-3.5'} flex flex-col justify-between gap-1.5`}>
          <div className="flex items-center justify-between gap-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Crews over duty
            </h2>
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium" style={{ color: crewTone.color }}>
              <span aria-hidden="true">{crewTone.icon}</span>
              <span>{crewTone.label}</span>
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-1">
            <div className="flex items-baseline gap-1.5">
              <span
                className={`font-mono-tabular ${compact ? 'text-2xl' : 'text-3xl'} font-semibold leading-none`}
                style={{ color: display.crewBreaches > 0 ? 'var(--breach-text)' : 'var(--ink)' }}
              >
                {display.crewBreaches}
              </span>
              <span className="font-mono-tabular text-[11px]" style={{ color: 'var(--muted)' }}>
                crew{display.crewBreaches === 1 ? '' : 's'}
              </span>
            </div>
            <DeltaBadge currentValue={display.crewBreaches} previousValue={compare ? compare.crewBreaches : null} previewMode={isPreview} />
          </div>
          <p className="font-mono-tabular text-[11px]" style={{ color: display.crewBreaches > 0 ? 'var(--breach-text)' : 'var(--muted)' }}>
            {display.crewBreaches > 0
              ? `+${display.totalCrewOverageMin}m total overage (>600m max)`
              : 'All active crews ≤ 600m duty'}
          </p>
        </article>
      </div>
    </section>
  );
}

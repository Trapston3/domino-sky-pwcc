import type { Objective, RecoveryRecommendation } from '../engine/types.js';

interface RecoveryCardProps {
  recommendation: RecoveryRecommendation;
  rank: number;
  objective: Objective;
  isPreviewing: boolean;
  onPreview: (rec: RecoveryRecommendation | null) => void;
  onFocusPreview: (rec: RecoveryRecommendation) => void;
  onApply: (rec: RecoveryRecommendation) => void;
}

function classifySideEffect(text: string): { icon: string; color: string; bg: string; border: string } {
  const lower = text.toLowerCase();
  if (
    lower.startsWith('clears') ||
    lower.startsWith('saves') ||
    lower.startsWith('reduces') ||
    lower.startsWith('cuts')
  ) {
    return { icon: '✓', color: 'var(--spare-text)', bg: 'var(--spare-bg)', border: 'var(--spare)' };
  }
  if (
    lower.startsWith('breaches') ||
    lower.startsWith('breaks') ||
    lower.startsWith('adds') ||
    lower.startsWith('over')
  ) {
    return { icon: '⚠', color: 'var(--breach-text)', bg: 'var(--breach-bg)', border: 'var(--breach)' };
  }
  if (lower.startsWith('cancels') || lower.startsWith('holds')) {
    return { icon: '◔', color: 'var(--delay-text)', bg: 'var(--delay-bg)', border: 'var(--delay)' };
  }
  return { icon: '•', color: 'var(--muted)', bg: 'var(--panel-elevated)', border: 'var(--border)' };
}

function formatMetricDelta(value: number, unit = ''): { text: string; color: string; icon: string } {
  if (value === 0) return { text: `0${unit}`, color: 'var(--muted)', icon: '=' };
  if (value < 0) return { text: `${value}${unit}`, color: 'var(--spare-text)', icon: '↓' };
  return { text: `+${value}${unit}`, color: 'var(--breach-text)', icon: '↑' };
}

/** Ranked recovery card with hover/focus KPI + map preview and diff side-effect tags. */
export function RecoveryCard({
  recommendation: rec,
  rank,
  objective,
  isPreviewing,
  onPreview,
  onFocusPreview,
  onApply,
}: RecoveryCardProps) {
  const delayDelta = formatMetricDelta(rec.diff.delayDeltaMin, 'm');
  const paxDelta = formatMetricDelta(rec.diff.strandedPaxDelta);
  const breachDelta = formatMetricDelta(rec.diff.breachesDelta);

  return (
    <article
      onMouseEnter={() => onPreview(rec)}
      onMouseLeave={() => onPreview(null)}
      onFocus={() => {
        onPreview(rec);
        onFocusPreview(rec);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onPreview(null);
        }
      }}
      className="rounded-xl border p-2.5 flex flex-col gap-2 transition-colors"
      style={{
        backgroundColor: isPreviewing ? 'var(--storm-bg)' : 'var(--panel-elevated)',
        borderColor: isPreviewing ? 'var(--storm)' : 'var(--border)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="font-mono-tabular rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={
                rank === 0
                  ? { backgroundColor: 'var(--pill-active-bg)', color: 'var(--pill-active-ink)' }
                  : { backgroundColor: 'var(--panel-solid)', color: 'var(--muted)' }
              }
            >
              #{rank + 1}
            </span>
            {rank === 0 && (
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--spare-text)' }}>
                Best for {objective}
              </span>
            )}
            {isPreviewing && (
              <span className="text-[10px] font-medium" style={{ color: 'var(--storm-text)' }}>
                ◎ Previewing
              </span>
            )}
          </div>
          <h4 className="text-xs font-semibold leading-snug" style={{ color: 'var(--ink)' }}>
            {rec.title}
          </h4>
        </div>

        <button
          type="button"
          onClick={() => onApply(rec)}
          aria-label={`Apply recommendation #${rank + 1}: ${rec.title}`}
          className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer"
          style={{ backgroundColor: 'var(--button-primary-bg)', color: 'var(--button-primary-ink)' }}
        >
          Apply
        </button>
      </div>

      {rec.actionLabels.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {rec.actionLabels.map((lbl, i) => (
            <span
              key={`${rec.id}-step-${i}`}
              className="font-mono-tabular rounded border px-1.5 py-0.5 text-[10px]"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel-solid)', color: 'var(--ink)' }}
            >
              Step {i + 1}: {lbl}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5 text-[11px]">
        {[
          ['Breaches', breachDelta],
          ['Stranded', paxDelta],
          ['Delay', delayDelta],
        ].map(([label, item]) => {
          const metric = item as { text: string; color: string; icon: string };
          return (
            <div
              key={String(label)}
              className="rounded-md border px-2 py-1"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel-solid)' }}
            >
              <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                {String(label)}
              </div>
              <div className="font-mono-tabular font-semibold" style={{ color: metric.color }}>
                <span aria-hidden="true">{metric.icon} </span>
                {metric.text}
              </div>
            </div>
          );
        })}
      </div>

      {rec.sideEffects.length > 0 && (
        <ul aria-label="Computed side effects" className="flex flex-wrap gap-1">
          {rec.sideEffects.map((effect, effIdx) => {
            const tone = classifySideEffect(effect);
            return (
              <li
                key={`${rec.id}-eff-${effIdx}`}
                className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]"
                style={{ backgroundColor: tone.bg, borderColor: tone.border, color: tone.color }}
              >
                <span aria-hidden="true">{tone.icon}</span>
                <span>{effect}</span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

import { useState } from 'react';
import { formatActionLabel } from '../engine/index.js';
import type {
  ClosureSpec,
  Objective,
  RecoveryAction,
  RecoveryRecommendation,
  SimulationSummary,
} from '../engine/types.js';

interface RecoveryRailProps {
  closure: ClosureSpec | null;
  objective: Objective;
  onSelectObjective: (objective: Objective) => void;
  recommendations: readonly RecoveryRecommendation[];
  appliedActions: readonly RecoveryAction[];
  currentSummary: SimulationSummary;
  previewId: string | null;
  actionError: string | null;
  onPreview: (rec: RecoveryRecommendation | null) => void;
  onApply: (rec: RecoveryRecommendation) => void;
  onUndo: () => void;
  onClear: () => void;
  onDismissError: () => void;
}

const OBJECTIVES: ReadonlyArray<{ id: Objective; label: string; icon: string; hint: string }> = [
  {
    id: 'compliance',
    label: 'Compliance',
    icon: '⚖',
    hint: 'Ranks 0 crew duty breaches first, then stranded pax, then delay.',
  },
  {
    id: 'passengers',
    label: 'Passengers',
    icon: '👥',
    hint: 'Minimizes missed-connection + cancelled passengers first.',
  },
  {
    id: 'delay',
    label: 'Delay',
    icon: '⏱',
    hint: 'Minimizes total network delay minutes first.',
  },
];

function classifySideEffect(text: string): { icon: string; color: string; bg: string; border: string } {
  const lower = text.toLowerCase();
  if (
    lower.startsWith('clears') ||
    lower.startsWith('saves') ||
    lower.startsWith('reduces') ||
    lower.startsWith('cuts')
  ) {
    return {
      icon: '✓',
      color: 'var(--spare-text)',
      bg: 'var(--spare-bg)',
      border: 'var(--spare)',
    };
  }
  if (
    lower.startsWith('breaches') ||
    lower.startsWith('breaks') ||
    lower.startsWith('adds') ||
    lower.startsWith('over')
  ) {
    return {
      icon: '⚠',
      color: 'var(--breach-text)',
      bg: 'var(--breach-bg)',
      border: 'var(--breach)',
    };
  }
  if (lower.startsWith('cancels') || lower.startsWith('holds')) {
    return {
      icon: '◔',
      color: 'var(--delay-text)',
      bg: 'var(--delay-bg)',
      border: 'var(--delay)',
    };
  }
  return {
    icon: '•',
    color: 'var(--muted)',
    bg: 'var(--panel-elevated)',
    border: 'var(--border)',
  };
}

function formatSignedDelta(value: number, unit = ''): { text: string; color: string; icon: string } {
  if (value === 0) {
    return { text: `0${unit}`, color: 'var(--muted)', icon: '=' };
  }
  if (value < 0) {
    return { text: `${value}${unit}`, color: 'var(--spare-text)', icon: '↓' };
  }
  return { text: `+${value}${unit}`, color: 'var(--breach-text)', icon: '↑' };
}

export function RecoveryRail({
  closure,
  objective,
  onSelectObjective,
  recommendations,
  appliedActions,
  currentSummary,
  previewId,
  actionError,
  onPreview,
  onApply,
  onUndo,
  onClear,
  onDismissError,
}: RecoveryRailProps) {
  const [showAll, setShowAll] = useState(false);

  const activeObjectiveMeta = OBJECTIVES.find((o) => o.id === objective) ?? OBJECTIVES[0];
  const visibleRecommendations = showAll ? recommendations : recommendations.slice(0, 6);
  const hasDisruption =
    closure !== null &&
    (currentSummary.lateFlights > 0 ||
      currentSummary.crewBreaches > 0 ||
      currentSummary.brokenConnections > 0);

  return (
    <aside
      aria-label="Recovery optimizer and applied actions"
      className="surface-panel rounded-xl p-4 flex flex-col gap-4 h-fit"
    >
      {/* Header & Objective Switcher */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Recovery Optimizer
          </h2>
          <span className="font-mono-tabular text-[11px]" style={{ color: 'var(--muted)' }}>
            {recommendations.length} option{recommendations.length === 1 ? '' : 's'}
          </span>
        </div>

        <div
          role="group"
          aria-label="Recovery optimization objective"
          className="grid grid-cols-3 gap-1.5 rounded-lg p-1 surface-elevated"
        >
          {OBJECTIVES.map((item) => {
            const isActive = objective === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectObjective(item.id)}
                aria-pressed={isActive}
                aria-label={`Optimize by ${item.label}: ${item.hint}`}
                className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                style={
                  isActive
                    ? {
                        backgroundColor: 'var(--pill-active-bg)',
                        color: 'var(--pill-active-ink)',
                      }
                    : {
                        backgroundColor: 'transparent',
                        color: 'var(--ink)',
                      }
                }
              >
                <span aria-hidden="true">{isActive ? '✓' : item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          {activeObjectiveMeta.hint}
        </p>
      </div>

      {/* Applied Action Stack */}
      <section aria-label="Applied recovery actions" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Applied stack ({appliedActions.length})
          </h3>
          {appliedActions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onUndo}
                aria-label="Undo last recovery action"
                className="surface-elevated rounded-md px-2 py-1 text-xs font-medium cursor-pointer"
                style={{ color: 'var(--ink)' }}
              >
                ↩ Undo
              </button>
              <button
                type="button"
                onClick={onClear}
                aria-label="Clear all applied recovery actions"
                className="rounded-md border px-2 py-1 text-xs font-medium cursor-pointer"
                style={{
                  backgroundColor: 'var(--breach-bg)',
                  color: 'var(--breach-text)',
                  borderColor: 'var(--breach)',
                }}
              >
                ✕ Clear
              </button>
            </div>
          )}
        </div>

        {appliedActions.length === 0 ? (
          <p
            className="rounded-lg border border-dashed px-3 py-2 text-xs"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            No recovery actions applied yet. Hover or focus a plan below to preview its KPI impact.
          </p>
        ) : (
          <ol className="flex flex-wrap gap-1.5">
            {appliedActions.map((action, idx) => (
              <li
                key={`${action.type}-${idx}-${formatActionLabel(action)}`}
                className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--spare-bg)',
                  color: 'var(--spare-text)',
                  borderColor: 'var(--spare)',
                }}
              >
                <span className="font-mono-tabular text-[11px] opacity-80">#{idx + 1}</span>
                <span>{formatActionLabel(action)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Action validation error */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: 'var(--breach-bg)',
            borderColor: 'var(--breach)',
            color: 'var(--breach-text)',
          }}
        >
          <span>▲ {actionError}</span>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="Dismiss recovery error message"
            className="font-semibold cursor-pointer px-1"
            style={{ color: 'var(--breach-text)' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Ranked Recommendations */}
      <section aria-label="Ranked recovery recommendations" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Ranked recommendations
          </h3>
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            Hover/focus to preview
          </span>
        </div>

        {recommendations.length === 0 ? (
          <div
            className="surface-elevated rounded-lg p-3 text-xs"
            style={{ color: hasDisruption ? 'var(--muted)' : 'var(--ontime-text)' }}
          >
            {hasDisruption
              ? 'No remaining valid single or paired recovery actions improve on the current plan.'
              : '✓ Network is clear of active delays, broken connections, and crew breaches.'}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {visibleRecommendations.map((rec, index) => {
              const isPreviewing = previewId === rec.id;
              const delayDelta = formatSignedDelta(rec.diff.delayDeltaMin, 'm');
              const paxDelta = formatSignedDelta(rec.diff.strandedPaxDelta);
              const breachDelta = formatSignedDelta(rec.diff.breachesDelta);

              return (
                <article
                  key={rec.id}
                  onMouseEnter={() => onPreview(rec)}
                  onMouseLeave={() => onPreview(null)}
                  onFocus={() => onPreview(rec)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      onPreview(null);
                    }
                  }}
                  className="rounded-xl border p-3 flex flex-col gap-2.5 transition-colors"
                  style={{
                    backgroundColor: isPreviewing ? 'var(--storm-bg)' : 'var(--panel-elevated)',
                    borderColor: isPreviewing ? 'var(--storm)' : 'var(--border)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="font-mono-tabular rounded px-1.5 py-0.5 text-[11px] font-semibold"
                          style={
                            index === 0
                              ? {
                                  backgroundColor: 'var(--pill-active-bg)',
                                  color: 'var(--pill-active-ink)',
                                }
                              : {
                                  backgroundColor: 'var(--panel-solid)',
                                  color: 'var(--muted)',
                                }
                          }
                        >
                          #{index + 1}
                        </span>
                        {index === 0 && (
                          <span
                            className="text-[11px] font-semibold uppercase tracking-wide"
                            style={{ color: 'var(--spare-text)' }}
                          >
                            Best for {objective}
                          </span>
                        )}
                        {isPreviewing && (
                          <span className="text-[11px] font-medium" style={{ color: 'var(--storm-text)' }}>
                            ◎ Previewing
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs sm:text-sm font-semibold leading-snug" style={{ color: 'var(--ink)' }}>
                        {rec.title}
                      </h4>
                    </div>

                    <button
                      type="button"
                      onClick={() => onApply(rec)}
                      aria-label={`Apply recommendation #${index + 1}: ${rec.title}`}
                      className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold cursor-pointer"
                      style={{
                        backgroundColor: 'var(--button-primary-bg)',
                        color: 'var(--button-primary-ink)',
                      }}
                    >
                      Apply
                    </button>
                  </div>

                  {/* Multi-action step chips when pair */}
                  {rec.actionLabels.length > 1 && (
                    <div className="flex flex-wrap gap-1">
                      {rec.actionLabels.map((lbl, i) => (
                        <span
                          key={`${rec.id}-step-${i}`}
                          className="font-mono-tabular rounded border px-1.5 py-0.5 text-[11px]"
                          style={{
                            borderColor: 'var(--border)',
                            backgroundColor: 'var(--panel-solid)',
                            color: 'var(--ink)',
                          }}
                        >
                          Step {i + 1}: {lbl}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Diff metrics */}
                  <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                    <div
                      className="rounded-md border px-2 py-1"
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel-solid)' }}
                    >
                      <div style={{ color: 'var(--muted)' }}>Breaches</div>
                      <div className="font-mono-tabular font-semibold" style={{ color: breachDelta.color }}>
                        <span aria-hidden="true">{breachDelta.icon} </span>
                        {breachDelta.text}
                      </div>
                    </div>
                    <div
                      className="rounded-md border px-2 py-1"
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel-solid)' }}
                    >
                      <div style={{ color: 'var(--muted)' }}>Stranded</div>
                      <div className="font-mono-tabular font-semibold" style={{ color: paxDelta.color }}>
                        <span aria-hidden="true">{paxDelta.icon} </span>
                        {paxDelta.text}
                      </div>
                    </div>
                    <div
                      className="rounded-md border px-2 py-1"
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--panel-solid)' }}
                    >
                      <div style={{ color: 'var(--muted)' }}>Delay</div>
                      <div className="font-mono-tabular font-semibold" style={{ color: delayDelta.color }}>
                        <span aria-hidden="true">{delayDelta.icon} </span>
                        {delayDelta.text}
                      </div>
                    </div>
                  </div>

                  {/* Engine-computed sideEffects tags */}
                  {rec.sideEffects.length > 0 && (
                    <ul aria-label="Computed side effects" className="flex flex-wrap gap-1.5">
                      {rec.sideEffects.map((effect, effIdx) => {
                        const tone = classifySideEffect(effect);
                        return (
                          <li
                            key={`${rec.id}-eff-${effIdx}`}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"
                            style={{
                              backgroundColor: tone.bg,
                              borderColor: tone.border,
                              color: tone.color,
                            }}
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
            })}

            {recommendations.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAll((prev) => !prev)}
                aria-expanded={showAll}
                aria-label={
                  showAll
                    ? 'Show fewer recovery recommendations'
                    : `Show all ${recommendations.length} recovery recommendations`
                }
                className="surface-elevated rounded-lg py-1.5 text-xs font-medium cursor-pointer"
                style={{ color: 'var(--ink)' }}
              >
                {showAll ? 'Show top 6' : `Show all ${recommendations.length} recommendations`}
              </button>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}

import { useState } from 'react';
import { formatActionLabel } from '../engine/index.js';
import type {
  ClosureSpec,
  Objective,
  RecoveryAction,
  RecoveryRecommendation,
  SimulationSummary,
} from '../engine/types.js';
import { RecoveryCard } from './RecoveryCard.js';

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
  onFocusPreview: (rec: RecoveryRecommendation) => void;
  onApply: (rec: RecoveryRecommendation) => void;
  onUndo: () => void;
  onClear: () => void;
  onDismissError: () => void;
}

const OBJECTIVES: ReadonlyArray<{ id: Objective; label: string; icon: string; hint: string }> = [
  { id: 'compliance', label: 'Compliance', icon: '⚖', hint: 'Clears crew duty breaches first, then stranded pax, then delay.' },
  { id: 'passengers', label: 'Passengers', icon: '👥', hint: 'Minimizes missed-connection + cancelled passengers first.' },
  { id: 'delay', label: 'Delay', icon: '⏱', hint: 'Minimizes total network delay minutes first.' },
];

/** Recovery optimizer panel: objective switcher, applied stack, and ranked recommendation cards. */
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
  onFocusPreview,
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
    <section
      aria-label="Recovery optimizer and applied actions"
      className="surface-panel rounded-xl p-3.5 flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Recovery Optimizer
          </h2>
          <span className="font-mono-tabular text-[11px]" style={{ color: 'var(--muted)' }}>
            {recommendations.length} option{recommendations.length === 1 ? '' : 's'}
          </span>
        </div>

        <div
          role="group"
          aria-label="Recovery optimization objective"
          className="grid grid-cols-3 gap-1 rounded-lg p-1 surface-elevated"
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
                className="inline-flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors cursor-pointer"
                style={
                  isActive
                    ? { backgroundColor: 'var(--pill-active-bg)', color: 'var(--pill-active-ink)' }
                    : { backgroundColor: 'transparent', color: 'var(--ink)' }
                }
              >
                <span aria-hidden="true">{isActive ? '✓' : item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {activeObjectiveMeta.hint}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Applied stack ({appliedActions.length})
          </h3>
          {appliedActions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onUndo}
                aria-label="Undo last recovery action"
                className="surface-elevated rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer"
                style={{ color: 'var(--ink)' }}
              >
                ↩ Undo
              </button>
              <button
                type="button"
                onClick={onClear}
                aria-label="Clear all applied recovery actions"
                className="rounded-md border px-2 py-0.5 text-[11px] font-medium cursor-pointer"
                style={{ backgroundColor: 'var(--breach-bg)', color: 'var(--breach-text)', borderColor: 'var(--breach)' }}
              >
                ✕ Clear
              </button>
            </div>
          )}
        </div>

        {appliedActions.length === 0 ? (
          <p className="rounded-lg border border-dashed px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            No recovery actions applied. Hover or focus any card to preview on map &amp; KPIs.
          </p>
        ) : (
          <ol className="flex flex-wrap gap-1.5">
            {appliedActions.map((action, idx) => (
              <li
                key={`${action.type}-${idx}-${formatActionLabel(action)}`}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: 'var(--spare-bg)', color: 'var(--spare-text)', borderColor: 'var(--spare)' }}
              >
                <span className="font-mono-tabular text-[10px] opacity-80">#{idx + 1}</span>
                <span>{formatActionLabel(action)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
          style={{ backgroundColor: 'var(--breach-bg)', borderColor: 'var(--breach)', color: 'var(--breach-text)' }}
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

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
            Recommendations
          </h3>
          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
            Hover/focus to preview
          </span>
        </div>

        {recommendations.length === 0 ? (
          <div className="surface-elevated rounded-lg p-2.5 text-xs" style={{ color: hasDisruption ? 'var(--muted)' : 'var(--ontime-text)' }}>
            {hasDisruption
              ? 'No remaining valid single or paired recovery actions improve on the current plan.'
              : '✓ Network clear of active delays, broken connections, and crew breaches.'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleRecommendations.map((rec, index) => (
              <RecoveryCard
                key={rec.id}
                recommendation={rec}
                rank={index}
                objective={objective}
                isPreviewing={previewId === rec.id}
                onPreview={onPreview}
                onFocusPreview={onFocusPreview}
                onApply={onApply}
              />
            ))}

            {recommendations.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAll((prev) => !prev)}
                aria-expanded={showAll}
                aria-label={showAll ? 'Show fewer recovery recommendations' : `Show all ${recommendations.length} recommendations`}
                className="surface-elevated rounded-lg py-1.5 text-xs font-medium cursor-pointer"
                style={{ color: 'var(--ink)' }}
              >
                {showAll ? 'Show top 6' : `Show all ${recommendations.length} recommendations`}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

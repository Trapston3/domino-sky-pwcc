import { useEffect, useMemo, useState } from 'react';
import { KpiStrip } from './components/KpiStrip.js';
import { PlainStatsView } from './components/PlainStatsView.js';
import { RecoveryRail } from './components/RecoveryRail.js';
import { ScenarioBar, type ThemeMode } from './components/ScenarioBar.js';
import { FLIGHT_NETWORK } from './data/flightNetwork.js';
import { formatActionLabel, optimizeRecovery, simulateNetwork } from './engine/index.js';
import type {
  ClosureSpec,
  Objective,
  RecoveryAction,
  RecoveryRecommendation,
  SimulationResult,
} from './engine/types.js';
import { DEFAULT_SCENARIO } from './scenarios.js';

function summarizeForAnnouncement(prefix: string, result: SimulationResult): string {
  const s = result.summary;
  return `${prefix}: ${s.lateFlights} late flights, ${s.totalDelayMin} delay minutes, ${s.strandedPax} stranded passengers, ${s.crewBreaches} crew breaches.`;
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>('night');
  const [closure, setClosure] = useState<ClosureSpec | null>(DEFAULT_SCENARIO.closure);
  const [appliedActions, setAppliedActions] = useState<RecoveryAction[]>([]);
  const [objective, setObjective] = useState<Objective>('compliance');
  const [previewRec, setPreviewRec] = useState<RecoveryRecommendation | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'night' ? 'dark' : 'light';
  }, [theme]);

  const baselineOutcome = useMemo(
    () => simulateNetwork(FLIGHT_NETWORK, closure, []),
    [closure],
  );

  const currentOutcome = useMemo(
    () => simulateNetwork(FLIGHT_NETWORK, closure, appliedActions),
    [closure, appliedActions],
  );

  const recommendations = useMemo(() => {
    if (!currentOutcome.ok) return [];
    return optimizeRecovery(FLIGHT_NETWORK, closure, objective, appliedActions);
  }, [closure, objective, appliedActions, currentOutcome.ok]);

  const previewOutcome = useMemo(() => {
    if (!previewRec) return null;
    return simulateNetwork(FLIGHT_NETWORK, closure, [...appliedActions, ...previewRec.actions]);
  }, [closure, appliedActions, previewRec]);

  function handleSelectClosure(nextClosure: ClosureSpec | null, label?: string) {
    setClosure(nextClosure);
    setAppliedActions([]);
    setPreviewRec(null);
    setActionError(null);

    const outcome = simulateNetwork(FLIGHT_NETWORK, nextClosure, []);
    const scenarioName =
      label ?? (nextClosure ? `${nextClosure.airport} ${nextClosure.start}–${nextClosure.end}` : 'Clear skies');
    if (outcome.ok) {
      setAnnouncement(summarizeForAnnouncement(`Scenario set to ${scenarioName}`, outcome));
    }
  }

  function handleSelectObjective(nextObjective: Objective) {
    setObjective(nextObjective);
    setPreviewRec(null);
    setAnnouncement(`Recovery optimizer objective changed to ${nextObjective}.`);
  }

  function handleApplyRecommendation(rec: RecoveryRecommendation) {
    const nextStack = [...appliedActions, ...rec.actions];
    const outcome = simulateNetwork(FLIGHT_NETWORK, closure, nextStack);
    if (!outcome.ok) {
      setActionError(outcome.reason);
      setAnnouncement(`Cannot apply recovery action: ${outcome.reason}`);
      return;
    }
    setAppliedActions(nextStack);
    setPreviewRec(null);
    setActionError(null);
    setAnnouncement(summarizeForAnnouncement(`Applied ${rec.title}`, outcome));
  }

  function handleUndo() {
    if (appliedActions.length === 0) return;
    const removed = appliedActions[appliedActions.length - 1];
    const nextStack = appliedActions.slice(0, -1);
    setAppliedActions(nextStack);
    setPreviewRec(null);
    setActionError(null);

    const outcome = simulateNetwork(FLIGHT_NETWORK, closure, nextStack);
    if (outcome.ok) {
      setAnnouncement(summarizeForAnnouncement(`Undid ${formatActionLabel(removed)}`, outcome));
    }
  }

  function handleClearActions() {
    if (appliedActions.length === 0) return;
    setAppliedActions([]);
    setPreviewRec(null);
    setActionError(null);

    const outcome = simulateNetwork(FLIGHT_NETWORK, closure, []);
    if (outcome.ok) {
      setAnnouncement(summarizeForAnnouncement('Cleared all recovery actions', outcome));
    }
  }

  function handleToggleTheme() {
    const nextTheme: ThemeMode = theme === 'night' ? 'day' : 'night';
    setTheme(nextTheme);
    setAnnouncement(`Switched to ${nextTheme === 'night' ? 'Night' : 'Day'} theme.`);
  }

  const baselineResult = baselineOutcome.ok ? baselineOutcome : null;
  const currentResult = currentOutcome.ok ? currentOutcome : null;
  const previewSummary = previewOutcome && previewOutcome.ok ? previewOutcome.summary : null;

  return (
    <div className="min-h-screen px-3 py-3 sm:px-5 sm:py-4 max-w-[1600px] mx-auto flex flex-col gap-4">
      <a
        href="#main-content"
        aria-label="Skip to main disruption view"
        className="skip-link"
      >
        Skip to main disruption view
      </a>

      {/* Single polite live region for scenario & recovery changes */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <ScenarioBar
        airports={FLIGHT_NETWORK.airports}
        closure={closure}
        surge={currentResult?.surge ?? null}
        theme={theme}
        onSelectClosure={handleSelectClosure}
        onToggleTheme={handleToggleTheme}
      />

      {!baselineResult || !currentResult ? (
        <main id="main-content" className="surface-panel rounded-xl p-6 text-sm" role="alert">
          <p style={{ color: 'var(--breach-text)' }}>
            ▲ Simulation failed:{' '}
            {!currentOutcome.ok ? currentOutcome.reason : !baselineOutcome.ok ? baselineOutcome.reason : 'Unknown error'}
          </p>
        </main>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_370px] xl:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
          <main
            id="main-content"
            aria-label="Network disruption KPIs and plain stats operational view"
            className="min-w-0 flex flex-col gap-4"
          >
            <KpiStrip
              baselineSummary={baselineResult.summary}
              currentSummary={currentResult.summary}
              previewSummary={previewSummary}
              previewTitle={previewRec?.title ?? null}
              appliedCount={appliedActions.length}
            />

            <PlainStatsView
              dataset={FLIGHT_NETWORK}
              baselineResult={baselineResult}
              currentResult={currentResult}
              previewResult={null}
              appliedCount={appliedActions.length}
            />
          </main>

          <RecoveryRail
            closure={closure}
            objective={objective}
            onSelectObjective={handleSelectObjective}
            recommendations={recommendations}
            appliedActions={appliedActions}
            currentSummary={currentResult.summary}
            previewId={previewRec?.id ?? null}
            actionError={actionError}
            onPreview={setPreviewRec}
            onApply={handleApplyRecommendation}
            onUndo={handleUndo}
            onClear={handleClearActions}
            onDismissError={() => setActionError(null)}
          />
        </div>
      )}
    </div>
  );
}

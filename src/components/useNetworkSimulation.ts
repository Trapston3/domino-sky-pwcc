import { useCallback, useMemo, useState } from 'react';
import { evaluateRecoveryPool, formatActionLabel, rankRecoveryPool, simulateNetwork } from '../engine/index.js';
import type {
  ClosureSpec,
  FlightNetworkDataset,
  Objective,
  RecoveryAction,
  RecoveryRecommendation,
  SimulationResult,
} from '../engine/types.js';
import { DEFAULT_SCENARIO } from '../scenarios.js';

function summarizeOutcome(prefix: string, result: SimulationResult): string {
  const s = result.summary;
  return `${prefix}: ${s.lateFlights} late flights, ${s.totalDelayMin} delay minutes, ${s.strandedPax} stranded passengers, ${s.crewBreaches} crew breaches.`;
}

/** Manages scenario closure, applied recovery stack, optimizer objective, preview state, and announcements. */
export function useNetworkSimulation(
  dataset: FlightNetworkDataset,
  onAnnounce: (msg: string) => void,
) {
  const [closure, setClosure] = useState<ClosureSpec | null>(DEFAULT_SCENARIO.closure);
  const [appliedActions, setAppliedActions] = useState<RecoveryAction[]>([]);
  const [objective, setObjective] = useState<Objective>('compliance');
  const [previewRec, setPreviewRec] = useState<RecoveryRecommendation | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const baselineOutcome = useMemo(() => simulateNetwork(dataset, closure, []), [dataset, closure]);
  const currentOutcome = useMemo(
    () => simulateNetwork(dataset, closure, appliedActions),
    [dataset, closure, appliedActions],
  );
  const recoveryPool = useMemo(
    () => (currentOutcome.ok ? evaluateRecoveryPool(dataset, closure, appliedActions) : []),
    [dataset, closure, appliedActions, currentOutcome.ok],
  );
  const recommendations = useMemo(
    () => rankRecoveryPool(recoveryPool, objective),
    [recoveryPool, objective],
  );
  const previewOutcome = useMemo(
    () => (previewRec ? simulateNetwork(dataset, closure, [...appliedActions, ...previewRec.actions]) : null),
    [dataset, closure, appliedActions, previewRec],
  );

  const baselineResult = baselineOutcome.ok ? baselineOutcome : null;
  const currentResult = currentOutcome.ok ? currentOutcome : null;
  const previewResult = previewOutcome && previewOutcome.ok ? previewOutcome : null;

  const selectClosure = useCallback(
    (nextClosure: ClosureSpec | null, label?: string) => {
      setClosure(nextClosure);
      setAppliedActions([]);
      setPreviewRec(null);
      setActionError(null);
      const outcome = simulateNetwork(dataset, nextClosure, []);
      const name = label ?? (nextClosure ? `${nextClosure.airport} ${nextClosure.start}–${nextClosure.end}` : 'Clear skies');
      if (outcome.ok) onAnnounce(summarizeOutcome(`Scenario set to ${name}`, outcome));
    },
    [dataset, onAnnounce],
  );

  const selectObjective = useCallback(
    (nextObjective: Objective) => {
      setObjective(nextObjective);
      setPreviewRec(null);
      onAnnounce(`Recovery optimizer objective changed to ${nextObjective}.`);
    },
    [onAnnounce],
  );

  const applyRecommendation = useCallback(
    (rec: RecoveryRecommendation) => {
      const nextStack = [...appliedActions, ...rec.actions];
      const outcome = simulateNetwork(dataset, closure, nextStack);
      if (!outcome.ok) {
        setActionError(outcome.reason);
        onAnnounce(`Cannot apply recovery action: ${outcome.reason}`);
        return;
      }
      setAppliedActions(nextStack);
      setPreviewRec(null);
      setActionError(null);
      onAnnounce(summarizeOutcome(`Applied ${rec.title}`, outcome));
    },
    [dataset, closure, appliedActions, onAnnounce],
  );

  const undoAction = useCallback(() => {
    if (appliedActions.length === 0) return;
    const removed = appliedActions[appliedActions.length - 1];
    const nextStack = appliedActions.slice(0, -1);
    setAppliedActions(nextStack);
    setPreviewRec(null);
    setActionError(null);
    const outcome = simulateNetwork(dataset, closure, nextStack);
    if (outcome.ok) onAnnounce(summarizeOutcome(`Undid ${formatActionLabel(removed)}`, outcome));
  }, [dataset, closure, appliedActions, onAnnounce]);

  const clearActions = useCallback(() => {
    if (appliedActions.length === 0) return;
    setAppliedActions([]);
    setPreviewRec(null);
    setActionError(null);
    if (baselineOutcome.ok) onAnnounce(summarizeOutcome('Cleared all recovery actions', baselineOutcome));
  }, [baselineOutcome, appliedActions.length, onAnnounce]);

  const clearError = useCallback(() => setActionError(null), []);

  return {
    closure,
    appliedActions,
    objective,
    previewRec,
    actionError,
    baselineOutcome,
    currentOutcome,
    baselineResult,
    currentResult,
    previewResult,
    recommendations,
    setPreviewRec,
    clearError,
    selectClosure,
    selectObjective,
    applyRecommendation,
    undoAction,
    clearActions,
  };
}

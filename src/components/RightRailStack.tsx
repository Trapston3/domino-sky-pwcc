import type {
  ClosureSpec,
  FlightNetworkDataset,
  Objective,
  RecoveryAction,
  RecoveryRecommendation,
  SimulationResult,
} from '../engine/types.js';
import { AiDispatcherPanel } from './AiDispatcherPanel.js';
import { KpiStrip } from './KpiStrip.js';
import { LiveEventFeed } from './LiveEventFeed.js';
import { RecoveryRail } from './RecoveryRail.js';

interface RightRailStackProps {
  dataset: FlightNetworkDataset;
  closure: ClosureSpec | null;
  baselineResult: SimulationResult;
  currentResult: SimulationResult;
  previewResult: SimulationResult | null;
  previewRec: RecoveryRecommendation | null;
  appliedActions: readonly RecoveryAction[];
  objective: Objective;
  recommendations: readonly RecoveryRecommendation[];
  actionError: string | null;
  onAnnounce: (message: string) => void;
  currentTimeMin: number;
  includeKpiAndFeed: boolean;
  onSelectObjective: (objective: Objective) => void;
  onPreview: (rec: RecoveryRecommendation | null) => void;
  onApply: (rec: RecoveryRecommendation) => void;
  onUndo: () => void;
  onClear: () => void;
  onDismissError: () => void;
  onSelectFlight: (flightId: string) => void;
  onSelectAirport: (airportId: string) => void;
}

/** Shared right rail stack composing KPIs + Live Feed (in map mode), AI Dispatcher, and Recovery Optimizer. */
export function RightRailStack({
  dataset,
  closure,
  baselineResult,
  currentResult,
  previewResult,
  previewRec,
  appliedActions,
  objective,
  recommendations,
  actionError,
  onAnnounce,
  currentTimeMin,
  includeKpiAndFeed,
  onSelectObjective,
  onPreview,
  onApply,
  onUndo,
  onClear,
  onDismissError,
  onSelectFlight,
  onSelectAirport,
}: RightRailStackProps) {
  return (
    <>
      {includeKpiAndFeed && (
        <>
          <KpiStrip
            layout="rail"
            baselineSummary={baselineResult.summary}
            currentSummary={currentResult.summary}
            previewSummary={previewResult?.summary ?? null}
            previewTitle={previewRec?.title ?? null}
            appliedCount={appliedActions.length}
          />
          <LiveEventFeed
            dataset={dataset}
            simulation={currentResult}
            currentTimeMin={currentTimeMin}
            onSelectFlight={onSelectFlight}
            onSelectAirport={onSelectAirport}
          />
        </>
      )}

      <RecoveryRail
        closure={closure}
        objective={objective}
        onSelectObjective={onSelectObjective}
        recommendations={recommendations}
        appliedActions={appliedActions}
        currentSummary={currentResult.summary}
        previewId={previewRec?.id ?? null}
        actionError={actionError}
        onPreview={onPreview}
        onFocusPreview={(rec) => onAnnounce(`Previewing recovery recommendation: ${rec.title}.`)}
        onApply={onApply}
        onUndo={onUndo}
        onClear={onClear}
        onDismissError={onDismissError}
      />

      <AiDispatcherPanel
        dataset={dataset}
        closure={closure}
        simulation={currentResult}
        appliedActions={appliedActions}
        objective={objective}
        recommendations={recommendations}
        onSelectFlight={onSelectFlight}
      />
    </>
  );
}

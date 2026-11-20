export type AirportTier = 'mega_hub' | 'regional_hub' | 'spoke';

export interface Airport {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  tier: AirportTier;
  capacity_per_hour: number;
}

export interface ScheduledFlight {
  flight_id: string;
  tail_id: string;
  leg_order: number;
  origin: string;
  destination: string;
  dep: string;
  arr: string;
  block_minutes: number;
  pax: number;
  turnaround_before_min: number | null;
}

export interface Connection {
  connection_id: string;
  airport: string;
  from_flight: string;
  to_flight: string;
  passengers: number;
  min_connect_minutes: number;
}

export interface Crew {
  crew_id: string;
  tail_id: string;
  base: string;
  duty_start: string;
  max_duty_mins: number;
  flight_ids: string[];
}

export interface SpareAircraft {
  tail_id: string;
  base: string;
  available_from: string;
  seats: number;
}

export interface FlightNetworkMeta {
  dataset: string;
  operating_day: string;
  min_turnaround_minutes: number;
  seats_per_aircraft: number;
  notes: string[];
}

export interface FlightNetworkDataset {
  meta: FlightNetworkMeta;
  airports: Airport[];
  flights: ScheduledFlight[];
  connections: Connection[];
  crews: Crew[];
  spare_aircraft: SpareAircraft[];
}

export interface ClosureSpec {
  airport: string;
  start: string;
  end: string;
}

export type Objective = 'compliance' | 'passengers' | 'delay';

export type RecoveryAction =
  | { type: 'SWAP_SPARE'; spareTail: string; flightId: string }
  | { type: 'CANCEL_TAIL_END'; tailId: string; count: number }
  | { type: 'CANCEL_LOOP'; firstFlightId: string; lastFlightId: string }
  | { type: 'HOLD_CONNECTION'; connectionId: string };

export type EngineErrorCode =
  | 'SPARE_ALREADY_USED'
  | 'SPARE_WRONG_HUB'
  | 'BREAKS_AIRCRAFT_CONTINUITY'
  | 'FLIGHT_NOT_FOUND'
  | 'INVALID_ACTION';

export interface SimulationFailure {
  ok: false;
  code: EngineErrorCode;
  reason: string;
}

export type FlightVisualStatus =
  | 'on_time'
  | 'minor_delay'
  | 'major_delay'
  | 'cancelled'
  | 'recovered';

export interface SimulatedFlight {
  flight_id: string;
  tail_id: string;
  operatingTail: string;
  leg_order: number;
  origin: string;
  destination: string;
  dep: string;
  arr: string;
  schedDepMin: number;
  schedArrMin: number;
  actualDepMin: number;
  actualArrMin: number;
  actualDepStr: string;
  actualArrStr: string;
  block_minutes: number;
  pax: number;
  turnaround_before_min: number | null;
  delayMin: number;
  turnaroundDelayMin: number;
  holdDelayMin: number;
  closureDelayMin: number;
  turnaroundSlackMin: number;
  cancelled: boolean;
  isSwapped: boolean;
  crewId: string;
  crewBreachLeg: boolean;
  causeSteps: string[];
  causeSummary: string;
  status: FlightVisualStatus;
}

export type ConnectionStatus = 'made' | 'broken' | 'cancelled';

export interface SimulatedConnection {
  connection_id: string;
  airport: string;
  from_flight: string;
  to_flight: string;
  passengers: number;
  min_connect_minutes: number;
  status: ConnectionStatus;
  slackMin: number;
  shortfallMin: number;
  held: boolean;
}

export interface SimulatedCrew {
  crewId: string;
  tailId: string;
  base: string;
  isStandby: boolean;
  dutyStartMin: number;
  dutyStartStr: string;
  lastArrMin: number;
  lastArrStr: string;
  dutyMin: number;
  maxDutyMins: number;
  breached: boolean;
  overageMin: number;
  operatedFlightIds: string[];
  breachedFlightIds: string[];
}

export interface ReopeningSurge {
  airport: string;
  windowStartMin: number;
  windowEndMin: number;
  windowStartStr: string;
  windowEndStr: string;
  movements: number;
  capacityPerHour: number;
  ratio: number;
  percent: number;
}

export interface SimulationSummary {
  totalFlights: number;
  operatedFlights: number;
  onTimeFlights: number;
  lateFlights: number;
  cancelledFlights: number;
  totalDelayMin: number;
  brokenConnections: number;
  missedConnectionPax: number;
  cancelledPax: number;
  strandedPax: number;
  crewBreaches: number;
  crewBreachAtRiskPax: number;
  totalCrewOverageMin: number;
}

export interface SimulationResult {
  ok: true;
  closure: (ClosureSpec & { startMin: number; endMin: number }) | null;
  actions: RecoveryAction[];
  flights: SimulatedFlight[];
  connections: SimulatedConnection[];
  crews: SimulatedCrew[];
  surge: ReopeningSurge | null;
  summary: SimulationSummary;
  passesUsed: number;
}

export type SimulationOutcome = SimulationResult | SimulationFailure;

export interface RecommendationDiff {
  delayDeltaMin: number;
  lateFlightsDelta: number;
  strandedPaxDelta: number;
  breachesDelta: number;
  clearedCrews: string[];
  addedCrews: string[];
  savedConnections: Array<{ connection_id: string; passengers: number }>;
  newlyBrokenConnections: Array<{ connection_id: string; passengers: number }>;
  cancelledFlightIds: string[];
  cancelledPax: number;
  sideEffects: string[];
}

export interface RecoveryRecommendation {
  id: string;
  title: string;
  actions: RecoveryAction[];
  actionLabels: string[];
  objective: Objective;
  summary: SimulationSummary;
  diff: RecommendationDiff;
  sideEffects: string[];
}

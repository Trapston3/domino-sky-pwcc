import { useEffect } from 'react';
import type { FlightNetworkDataset, SimulationResult } from '../engine/types.js';
import { DominoTraceAirportView } from './DominoTraceAirportView.js';
import { DominoTraceFlightView } from './DominoTraceFlightView.js';

interface DominoTraceCardProps {
  dataset: FlightNetworkDataset;
  simulation: SimulationResult;
  currentTimeMin: number;
  selectedFlightId: string | null;
  selectedAirportId: string | null;
  onSelectFlight: (flightId: string) => void;
  onSelectAirport: (airportId: string) => void;
  onClose: () => void;
}

/** Accessible Domino Trace inspector card (Escape closes) for a selected flight or airport. */
export function DominoTraceCard({
  dataset,
  simulation,
  currentTimeMin,
  selectedFlightId,
  selectedAirportId,
  onSelectFlight,
  onSelectAirport,
  onClose,
}: DominoTraceCardProps) {
  const selectedFlight = selectedFlightId
    ? simulation.flights.find((f) => f.flight_id === selectedFlightId) ?? null
    : null;
  const selectedAirport =
    !selectedFlight && selectedAirportId
      ? dataset.airports.find((a) => a.id === selectedAirportId) ?? null
      : null;

  useEffect(() => {
    if (!selectedFlight && !selectedAirport) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedFlight, selectedAirport, onClose]);

  if (selectedFlight) {
    return (
      <DominoTraceFlightView
        flight={selectedFlight}
        simulation={simulation}
        onSelectFlight={onSelectFlight}
        onSelectAirport={onSelectAirport}
        onClose={onClose}
      />
    );
  }

  if (selectedAirport) {
    return (
      <DominoTraceAirportView
        airport={selectedAirport}
        simulation={simulation}
        currentTimeMin={currentTimeMin}
        onSelectFlight={onSelectFlight}
        onClose={onClose}
      />
    );
  }

  return null;
}

import { describe, expect, it } from 'vitest';
import { FLIGHT_NETWORK } from '../../data/flightNetwork.js';
import { simulateNetwork } from '../../engine/index.js';
import type { SimulationResult } from '../../engine/types.js';
import { answerGroundedQuestion } from '../askFallback.js';

function baseline(): SimulationResult {
  const result = simulateNetwork(FLIGHT_NETWORK, null, []);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function ask(question: string): string {
  const result = baseline();
  return answerGroundedQuestion(FLIGHT_NETWORK, null, [], 'compliance', result, result, [], question);
}

describe('offline explicit action questions', () => {
  it('simulates a valid spare swap and reports computed Before → After metrics', () => {
    expect(ask('swap VT-DS18 onto DS0304')).toMatch(/Swap VT-DS18 onto DS0304 verified\. Before → After: late flights \d+ → \d+/);
  });

  it('simulates a valid connection hold', () => {
    expect(ask('hold CX12')).toMatch(/Hold CX12 verified\. Before → After:/);
  });

  it('returns a structured continuity error for a single mid-chain cancellation', () => {
    expect(ask('cancel only DS1003')).toMatch(/BREAKS_AIRCRAFT_CONTINUITY/);
  });
});

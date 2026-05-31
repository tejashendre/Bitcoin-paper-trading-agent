import { z } from 'zod';

export const brainDecisionSchema = z.object({
  action: z.enum(['BUY', 'SELL', 'SHORT', 'COVER', 'HOLD']),
  confidence: z.number().min(0).max(100).describe("0-100 confidence score based on confluence"),
  conviction: z.enum(['LOW', 'MEDIUM', 'HIGH']).describe("Qualitative conviction level"),
  thesis: z.string().describe("A concise 1-2 sentence justification for the decision"),
  takeProfitPrice: z.number().nullable().describe("Suggested take profit price, or null if HOLD/Close"),
  stopLossPrice: z.number().nullable().describe("Suggested stop loss price, or null if HOLD/Close"),
  suggestedSizeUsd: z.number().nullable().describe("Suggested position size in USD, or null to let risk manager decide"),
  timeHorizon: z.enum(['SCALP', 'DAY', 'SWING']).describe("Expected duration of the trade"),
  expected15mDirection: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe("Predicted price direction in 15 minutes"),
  expected1hDirection: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe("Predicted price direction in 1 hour"),
  expected4hDirection: z.enum(['UP', 'DOWN', 'SIDEWAYS']).describe("Predicted price direction in 4 hours"),
});

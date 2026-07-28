import type { ClassificationResult } from "./types.js";

/**
 * A dispatch report is, semantically: "a vehicle is LEAVING this facility,
 * carrying motorcycles, headed to a destination." Every signal below maps
 * to one piece of that sentence instead of matching literal phrasings.
 */

// Vehicle is leaving. Deliberately does NOT include the bare word "parte"
// (too common/ambiguous in Spanish — "por la parte posterior" etc.).
const DEPARTURE_VERB =
  /\b(sale|sali[oó]|se retira|retir[aá]ndose|retirad[oa]|despach[oa]|despachad[oa])\b/i;

// Vehicle is arriving — the semantic opposite. Used as a veto, not just a
// negative keyword, because "sale" and "ingresa" can't both be true of the
// same movement.
const ARRIVAL_VERB = /\b(ingresa|ingres[oó]|entra|entr[oó])\b/i;

// Presence of a plate is the single strongest "this is really a vehicle
// dispatch" signal in this dataset — every valid message has one.
const PLATE_LABEL = /\bplacas?\b/i;
const PLATE_PATTERN = /\bplacas?\s*:?\s*([A-Z0-9]{5,8})\b/i;

// Cargo: motorcycles, with a count.
const MOTOS_COUNT = /\b(\d+)\s*motos?\b/i;

// Driver identification (any of: cédula/CI, "conducido por", "chófer", cddno).
const DRIVER_INFO =
  /\b(c[ée]dula|CI\s*:|C\.I\.?\s*:?|cddno|conducido por|ch[oó]fer)\b/i;

// Destination reference (concessionaire / client / "destino" / "dirección al").
const DESTINATION = /\b(destino|direcci[oó]n al?|concesionario|cliente)\b/i;

// Supporting paperwork mentioned in almost every real dispatch.
const DOCS = /\b(factura|fact\.|nota de control|garant[ií]a)\b/i;

/**
 * Classify a WhatsApp message as a dispatch or non-dispatch report.
 *
 * Strategy: a hard gate + a weighted confidence score.
 *
 * The gate encodes the non-negotiable structural requirement — "this must
 * describe a vehicle LEAVING with a plate or a motorcycle count" — so that
 * keyword-stuffed but irrelevant messages (supplier deliveries, employee
 * movements, arrival reports that happen to mention "vehículo") can't
 * accumulate enough score to pass, no matter how the scoring weights are
 * tuned later. The score on top of the gate is what feeds `confidence` and
 * lets you tighten/loosen the threshold without touching the gate itself.
 *
 * @param text - The raw message text (may be undefined)
 * @returns ClassificationResult
 */
export function classifyDispatch(
  text: string | undefined
): ClassificationResult {
  if (!text || text.trim().length === 0) {
    return { isDispatch: false, confidence: 0, dispatchType: null };
  }

  const hasDeparture = DEPARTURE_VERB.test(text);
  const hasArrival = ARRIVAL_VERB.test(text);
  const hasPlate = PLATE_LABEL.test(text) || PLATE_PATTERN.test(text);
  const hasMotos = MOTOS_COUNT.test(text);
  const hasDriver = DRIVER_INFO.test(text);
  const hasDestination = DESTINATION.test(text);
  const hasDocs = DOCS.test(text);

  // GATE: must be a departure, must not simultaneously be an arrival report,
  // and must show actual vehicle-dispatch structure (plate or moto count).
  const gate = hasDeparture && !hasArrival && (hasPlate || hasMotos);

  let score = 0;
  if (hasDeparture) score += 0.3;
  if (hasPlate) score += 0.2;
  if (hasMotos) score += 0.25;
  if (hasDriver) score += 0.1;
  if (hasDestination) score += 0.1;
  if (hasDocs) score += 0.05;
  const confidence = Math.min(score, 1.0);

  const THRESHOLD = 0.6;
  const isDispatch = gate && confidence >= THRESHOLD;

  let dispatchType: string | null = null;
  if (isDispatch) {
    dispatchType = "dispatch";
  }

  return {
    isDispatch,
    confidence: Math.round(confidence * 100) / 100,
    dispatchType,
  };
}

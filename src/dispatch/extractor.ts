import type { DispatchFields } from "./types.js";

/**
 * Extract structured fields from a dispatch WhatsApp message.
 *
 * Every field defaults to null — regex extraction is best-effort against
 * free-form Spanish text. A failed match on one field never blocks the
 * others. `destinationName` in particular is deliberately loose: treat it
 * as a raw candidate string to feed into `matchCompany()` (fuzzy match
 * against the known company list), not as a guaranteed-clean value —
 * free text destinations will never be 100% regex-extractable.
 *
 * @param text - The raw dispatch message text
 * @returns DispatchFields — all extracted fields
 */
export function extractDispatchFields(text: string): DispatchFields {
  const extract = (pattern: RegExp): string | null => {
    const match = text.match(pattern);
    if (!match) return null;
    const value = match[1] ?? match[0];
    return value ? value.trim() : null;
  };

  return {
    vehicleType: extract(
      /veh[ií]culo\s*:?\s*(?:marca\s*:?\s*)?([A-Za-zÀ-ÿ0-9\-]+(?:\s+[A-Za-zÀ-ÿ0-9\-]+){0,3}?)(?=\s*(?:,|\.|\n|tipo\b|placas?\b|ch[oó]fer\b|conducido\b|$))/i
    ),

    plate: extract(/placas?\s*:?\s*([A-Z0-9]{5,8})\b/i),

    driverName: (() => {
      const conducido = extract(
        /conducido por(?:\s+el)?\s+(?:ciudadano|cddno|cdño)?\s*:?\s*([A-ZÀ-ÿ][A-Za-zÀ-ÿ\s]*?)(?=\s*(?:,|\.|CI\b|C\.I\b|c[ée]dula|tel[eé]fono|TLF|$))/i
      );
      if (conducido) return conducido;
      // Fallback for messages that name the driver via "Chófer NAME"
      // instead of "conducido por ..." (e.g. the HYUNDAI/AYAH format).
      return extract(
        /ch[oó]fer\s+([A-ZÀ-ÿ][A-Za-zÀ-ÿ\s]*?)(?=\s*(?:,|\.|CI\b|C\.I\b|c[ée]dula|tel[eé]fono|TLF|$))/i
      );
    })(),

    driverId: extract(
      /\b(?:c[ée]dula|CI|C\.I\.?)\s*(?:nro\.?|n[°uú]m?\.?)?\s*:?\s*(?:[a-zA-Z]\.?\s*)?([\d.]{6,12})/i
    ),

    driverPhone: extract(/\b(0\d{3}[-.\s]?\d{6,7})\b/),

    motorcycleCount: (() => {
      const raw =
        extract(/cantidad de (\d+)\s*motos?\b/i) ??
        extract(/(\d+)\s*motos?\b/i);
      return raw ? parseInt(raw, 10) : null;
    })(),

    // Best-effort raw destination text — intentionally loose, meant to be
    // cleaned up further by matchCompany() rather than trusted verbatim.
    destinationName: (() => {
      const raw = extract(
        /(?:con\s+)?(?:destino|direcci[oó]n)\s+(?:al?\s+)?(?:concesionario|cliente)?\s*[:,]?\s*([\s\S]+?)(?=,?\s*(?:Factura|factura|NOTA|Nota|N[uú]mero|seg[uú]n|garant[ií]a|celular|tel[eé]fono|conductor|\.$)|\n|$)/i
      );
      return raw ? raw.replace(/\s+/g, " ").trim().replace(/[.,]+$/, "") : null;
    })(),

    matchedCompanyId: null,
    matchedConfidence: null,

    invoices: (() => {
      const idx = text.search(/factura|fact\./i);
      if (idx === -1) return null;
      const rest = text.slice(idx);
      const stopIdx = rest.search(
        /nota\s+de\s+control|n[uú]mero\s+de\s+control|garant[ií]a/i
      );
      const windowText = stopIdx > 0 ? rest.slice(0, stopIdx) : rest.slice(0, 200);
      const nums = windowText.match(/\d{4,8}/g);
      return nums && nums.length ? [...new Set(nums)].join(", ") : null;
    })(),

    controlNotes: (() => {
      const match = text.match(/n[uú]mero\s+de\s+control|nota\s+de\s+control/i);
      if (!match || match.index === undefined) return null;
      const window = text.slice(match.index, match.index + 100);
      const nums = window.match(/\d{4,8}/g);
      return nums && nums.length ? [...new Set(nums)].join(", ") : null;
    })(),

    franelas: (() => {
      const raw = extract(/(\d+)\s*franelas/i);
      return raw ? parseInt(raw, 10) : null;
    })(),

    warranty: extract(
      /garant[ií]a\s*(?:n[uú°]?m?\.?|nro\.?)?\s*[:-]?\s*\(?(\d[\d-]{2,9})\)?/i
    ),
  };
}

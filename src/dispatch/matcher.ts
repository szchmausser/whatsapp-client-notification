import type { Company } from "./types.js";

/** Minimum word overlap ratio to consider a partial match */
const MIN_OVERLAP_RATIO = 0.4;

/**
 * Compute Levenshtein distance between two strings.
 * Used for fuzzy company name matching.
 */
function levenshtein(a: string, b: string): number {
  const alen = a.length;
  const blen = b.length;

  // Use a single-row optimization for smaller memory
  let prev: number[] = [];
  let curr: number[] = [];

  for (let j = 0; j <= blen; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= alen; i++) {
    curr[0] = i;
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[blen];
}

/**
 * Normalize a string for comparison: lowercase, trim, collapse whitespace.
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Compute word overlap ratio between two normalized strings.
 * Returns a value 0.0 – 1.0.
 */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  // Jaccard-like: intersection / min(sizeA, sizeB)
  return intersection / Math.min(wordsA.size, wordsB.size);
}

/**
 * Match a destination name against a list of known companies.
 *
 * Strategy:
 * 1. Exact match (after normalization) — instant result, confidence 1.0
 * 2. Alias match — any alias matches the destination → confidence 0.9
 * 3. Keyword match — any keyword found in destination → confidence 0.7
 * 4. Fuzzy (Levenshtein) — edit distance similarity >= 0.7 → confidence 0.6
 * 5. Word overlap — significant word overlap → confidence scaled by ratio
 *
 * Returns the best match or null if no match exceeds the minimum threshold.
 *
 * @param destinationName - Extracted destination name (may be null)
 * @param companies - Array of company entries to match against
 * @returns Matched company info or null
 */
export function matchCompany(
  destinationName: string | null,
  companies: Company[]
): { companyId: number; confidence: number } | null {
  if (!destinationName || destinationName.trim().length === 0) {
    return null;
  }

  const dest = normalize(destinationName);

  let bestMatch: { companyId: number; confidence: number } | null = null;

  for (const company of companies) {
    const nameNorm = normalize(company.name);

    // 1. Exact match
    if (dest === nameNorm) {
      return { companyId: company.id, confidence: 1.0 };
    }

    // 2. Alias match
    for (const alias of company.aliases) {
      const aliasNorm = normalize(alias);
      if (dest === aliasNorm) {
        return { companyId: company.id, confidence: 0.95 };
      }
    }

    // 3. Keyword found in destination
    for (const kw of company.keywords) {
      const kwNorm = normalize(kw);
      if (dest.includes(kwNorm)) {
        const conf = Math.min(0.7 + kwNorm.length / dest.length * 0.2, 0.9);
        if (!bestMatch || conf > bestMatch.confidence) {
          bestMatch = { companyId: company.id, confidence: Math.round(conf * 100) / 100 };
        }
      }
    }

    // 4. Levenshtein similarity
    const maxLen = Math.max(dest.length, nameNorm.length);
    if (maxLen > 0) {
      const dist = levenshtein(dest, nameNorm);
      const similarity = 1 - dist / maxLen;
      if (similarity >= 0.7) {
        if (!bestMatch || similarity > bestMatch.confidence) {
          bestMatch = {
            companyId: company.id,
            confidence: Math.round(similarity * 100) / 100,
          };
        }
      }
    }

    // 5. Word overlap
    const overlap = wordOverlap(dest, nameNorm);
    if (overlap >= MIN_OVERLAP_RATIO) {
      if (!bestMatch || overlap > bestMatch.confidence) {
        bestMatch = {
          companyId: company.id,
          confidence: Math.round(overlap * 100) / 100,
        };
      }
    }
  }

  return bestMatch;
}

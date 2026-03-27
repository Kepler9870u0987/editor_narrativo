/**
 * PII Masking Trust Layer — Dynamic detection and masking of Personally
 * Identifiable Information before forwarding prompts to external LLM APIs.
 *
 * Tokens are ephemeral (in-memory only, scoped to a single request lifecycle).
 * The mapping is destroyed after de-masking the response.
 */

import type { PIIMask } from '@editor-narrativo/shared';

// ── PII Detection Patterns ────────────────────────────────────

const PII_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, label: 'EMAIL' },
  // Phone numbers (international and local formats)
  { pattern: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g, label: 'PHONE' },
  // Italian fiscal code (codice fiscale)
  { pattern: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, label: 'FISCAL_CODE' },
  // Dates in common formats
  { pattern: /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g, label: 'DATE' },
  // Capitalized proper names (2+ words, heuristic)
  { pattern: /\b[A-Z][a-zà-ü]+(?:\s[A-Z][a-zà-ü]+)+\b/g, label: 'NAME' },
];

export class PIIMasker {
  private masks: PIIMask[] = [];
  private counter = 0;

  /**
   * Mask PII in the input text. Returns the masked text.
   * The internal mapping is kept for de-masking.
   */
  mask(text: string): string {
    let masked = text;

    for (const { pattern, label } of PII_PATTERNS) {
      // Reset regex state for global patterns
      pattern.lastIndex = 0;
      masked = masked.replace(pattern, (match) => {
        // Avoid double-masking already masked tokens
        if (match.startsWith('<ENTITY_')) return match;

        const token = `<ENTITY_${label}_${this.counter++}>`;
        this.masks.push({ token, original: match });
        return token;
      });
    }

    return masked;
  }

  /**
   * De-mask a response text, replacing ephemeral tokens back to originals.
   */
  demask(text: string): string {
    let demasked = text;
    // Apply in reverse order to handle nested/overlapping replacements
    for (let i = this.masks.length - 1; i >= 0; i--) {
      const { token, original } = this.masks[i]!;
      demasked = demasked.replaceAll(token, original);
    }
    return demasked;
  }

  /**
   * Destroy the mapping. Call this when the request lifecycle ends.
   */
  destroy(): void {
    this.masks = [];
    this.counter = 0;
  }

  get maskCount(): number {
    return this.masks.length;
  }
}

import { describe, it, expect } from 'vitest';
import { PIIMasker } from '../src/pii-masker.js';

describe('PIIMasker', () => {
  it('masks email addresses', () => {
    const masker = new PIIMasker();
    const masked = masker.mask('Contatta marco.rossi@email.com per info.');

    expect(masked).not.toContain('marco.rossi@email.com');
    expect(masked).toContain('<ENTITY_EMAIL_');
    expect(masker.maskCount).toBe(1);

    masker.destroy();
  });

  it('masks proper names (multi-word capitalized)', () => {
    const masker = new PIIMasker();
    const masked = masker.mask('Il protagonista Marco Rossi entrò nella stanza.');

    expect(masked).not.toContain('Marco Rossi');
    expect(masked).toContain('<ENTITY_NAME_');

    masker.destroy();
  });

  it('de-masks correctly', () => {
    const masker = new PIIMasker();
    const original = 'Marco Rossi è nato il 15/03/1990 a Roma.';
    const masked = masker.mask(original);

    expect(masked).not.toContain('Marco Rossi');
    expect(masked).not.toContain('15/03/1990');

    const demasked = masker.demask(masked);
    expect(demasked).toContain('Marco Rossi');
    expect(demasked).toContain('15/03/1990');

    masker.destroy();
  });

  it('handles text with no PII', () => {
    const masker = new PIIMasker();
    const text = 'il castello era buio e silenzioso.';
    const masked = masker.mask(text);

    expect(masked).toBe(text);
    expect(masker.maskCount).toBe(0);

    masker.destroy();
  });

  it('destroy clears all masks', () => {
    const masker = new PIIMasker();
    masker.mask('Marco Rossi ha scritto a test@example.com');

    expect(masker.maskCount).toBeGreaterThan(0);

    masker.destroy();
    expect(masker.maskCount).toBe(0);
  });

  it('de-masks LLM response containing masked tokens', () => {
    const masker = new PIIMasker();
    masker.mask('Marco Rossi vive a Roma con Giulia Bianchi.');

    // Simulate an LLM response that echoes back the masked tokens
    const llmResponse = 'Il conflitto riguarda <ENTITY_NAME_0> e <ENTITY_NAME_1>.';
    const demasked = masker.demask(llmResponse);

    expect(demasked).toContain('Marco Rossi');
    expect(demasked).toContain('Giulia Bianchi');

    masker.destroy();
  });
});

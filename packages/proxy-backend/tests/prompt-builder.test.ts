import { describe, it, expect } from 'vitest';
import {
  buildLogicCheckPrompt,
  extractJSONObject,
  parseLogicCheckResponse,
} from '../src/prompt-builder.js';

describe('buildLogicCheckPrompt', () => {
  it('builds a valid prompt with RAG context', () => {
    const messages = buildLogicCheckPrompt({
      sceneText: 'Marco entrò nella stanza alle 3 di notte.',
      ragContext: [
        'Marco era partito per Londra la mattina stessa.',
        'La stanza era stata demolita il giorno prima.',
      ],
      sessionId: 'test-session',
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('Revisore Analitico');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('Marco entrò');
    expect(messages[1]!.content).toContain('STORY BIBLE');
    expect(messages[1]!.content).toContain('partito per Londra');
  });

  it('handles empty RAG context', () => {
    const messages = buildLogicCheckPrompt({
      sceneText: 'Test scene.',
      ragContext: [],
      sessionId: 'test-session',
    });

    expect(messages[1]!.content).toContain('Nessun passaggio disponibile');
  });
});

describe('parseLogicCheckResponse', () => {
  it('parses valid JSON response', () => {
    const response = JSON.stringify({
      hasConflict: true,
      conflicts: [
        { description: 'Marco non può essere in due posti', severity: 'high' },
      ],
      evidence_chains: [
        {
          sceneStatement: 'Marco entrò nella stanza alle 3 di notte',
          bibleExcerpt: 'Marco era partito per Londra la mattina stessa',
          contradiction: 'Non può essere a Roma e Londra contemporaneamente',
        },
      ],
    });

    const result = parseLogicCheckResponse(response);
    expect(result).not.toBeNull();
    expect(result!.hasConflict).toBe(true);
    expect(result!.conflicts).toHaveLength(1);
    expect(result!.evidence_chains).toHaveLength(1);
  });

  it('parses no-conflict response', () => {
    const response = JSON.stringify({
      hasConflict: false,
      conflicts: [],
      evidence_chains: [],
    });

    const result = parseLogicCheckResponse(response);
    expect(result).not.toBeNull();
    expect(result!.hasConflict).toBe(false);
  });

  it('extracts JSON from markdown-wrapped response', () => {
    const response = '```json\n{"hasConflict": false, "conflicts": [], "evidence_chains": []}\n```';
    const result = parseLogicCheckResponse(response);
    expect(result).not.toBeNull();
    expect(result!.hasConflict).toBe(false);
  });

  it('extracts the first balanced JSON object from noisy output', () => {
    const response = 'Analisi completata:\n{"hasConflict": false, "conflicts": [], "evidence_chains": []}\nNota finale {non-json}';
    expect(extractJSONObject(response)).toBe(
      '{"hasConflict": false, "conflicts": [], "evidence_chains": []}',
    );
  });

  it('returns null on invalid JSON', () => {
    expect(parseLogicCheckResponse('not json')).toBeNull();
  });

  it('returns null on missing required fields', () => {
    expect(parseLogicCheckResponse('{"foo": "bar"}')).toBeNull();
  });

  it('returns null on invalid severity value', () => {
    const response = JSON.stringify({
      hasConflict: true,
      conflicts: [{ description: 'test', severity: 'INVALID' }],
      evidence_chains: [],
    });
    expect(parseLogicCheckResponse(response)).toBeNull();
  });
});

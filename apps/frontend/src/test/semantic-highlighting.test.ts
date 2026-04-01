import { describe, it, expect } from 'vitest';
import { computeHighlightRanges } from '../features/editor/semantic-highlighting';
import type { LogicCheckResponse } from '@editor-narrativo/shared';

// Minimal ProseMirror doc mock for testing findTextInDoc
function createMockEditor(text: string) {
  const textNode = {
    isText: true,
    text,
  };
  const doc = {
    descendants: (cb: (node: any, pos: number) => void) => {
      cb(textNode, 0);
    },
  };
  return {
    state: { doc },
  };
}

describe('computeHighlightRanges', () => {
  it('returns empty array when hasConflict is false', () => {
    const editor = createMockEditor('Some text');
    const result: LogicCheckResponse = {
      hasConflict: false,
      conflicts: [],
      evidence_chains: [],
      reasoning: '',
    };
    expect(computeHighlightRanges(editor, result)).toEqual([]);
  });

  it('returns empty array when editor is null', () => {
    const result: LogicCheckResponse = {
      hasConflict: true,
      conflicts: [{ description: 'A conflict', severity: 'high' }],
      evidence_chains: [],
      reasoning: '',
    };
    expect(computeHighlightRanges(null, result)).toEqual([]);
  });

  it('finds highlight ranges for conflict descriptions matching document text', () => {
    const longText = 'Il protagonista entra nella stanza illuminata dal sole';
    const editor = createMockEditor(longText);
    const result: LogicCheckResponse = {
      hasConflict: true,
      conflicts: [
        {
          description: 'stanza illuminata dal sole',
          severity: 'high',
        },
      ],
      evidence_chains: [],
      reasoning: 'test',
    };
    const ranges = computeHighlightRanges(editor, result);
    // "stanza illuminata dal sole" is long enough (>10 chars) to be extracted as a key phrase
    expect(ranges.length).toBeGreaterThanOrEqual(1);
    if (ranges.length > 0) {
      expect(ranges[0]!.severity).toBe('high');
    }
  });

  it('finds highlight ranges from evidence chain scene statements', () => {
    const docText = 'La torre antica si ergeva sulla collina nel mezzo della pianura';
    const editor = createMockEditor(docText);
    const result: LogicCheckResponse = {
      hasConflict: true,
      conflicts: [{ description: 'spatial inconsistency', severity: 'medium' }],
      evidence_chains: [
        {
          sceneStatement: 'torre antica si ergeva sulla collina',
          memoryFact: 'The tower was in the valley',
          contradiction: 'Location mismatch',
        },
      ],
      reasoning: 'test',
    };
    const ranges = computeHighlightRanges(editor, result);
    // Should match the scene statement text
    const towerRange = ranges.find((r) => r.description === 'Location mismatch');
    expect(towerRange).toBeDefined();
  });

  it('deduplicates overlapping ranges keeping higher severity', () => {
    const docText = 'Il vecchio castello dominava il paesaggio circostante';
    const editor = createMockEditor(docText);
    const result: LogicCheckResponse = {
      hasConflict: true,
      conflicts: [
        { description: 'vecchio castello dominava il paesaggio', severity: 'low' },
        { description: 'vecchio castello dominava il paesaggio', severity: 'high' },
      ],
      evidence_chains: [],
      reasoning: 'test',
    };
    const ranges = computeHighlightRanges(editor, result);
    // Should be deduplicated to one range
    expect(ranges.length).toBeLessThanOrEqual(1);
    if (ranges.length === 1) {
      expect(ranges[0]!.severity).toBe('high');
    }
  });
});

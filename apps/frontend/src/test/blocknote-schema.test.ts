import { describe, it, expect } from 'vitest';
import {
  blocksToPlainText,
  collectNarrativeEntities,
  collectNarrativeAlerts,
  type NarrativeBlockLike,
} from '../features/editor/blocknote-schema';

describe('blocksToPlainText', () => {
  it('extracts text from simple paragraph blocks', () => {
    const blocks: NarrativeBlockLike[] = [
      { id: '1', type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      { id: '2', type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
    ];
    const result = blocksToPlainText(blocks);
    expect(result).toContain('Hello world');
    expect(result).toContain('Second paragraph');
  });

  it('extracts text from string content', () => {
    const blocks: NarrativeBlockLike[] = [
      { id: '1', type: 'paragraph', content: 'Plain string content' },
    ];
    expect(blocksToPlainText(blocks)).toContain('Plain string content');
  });

  it('extracts entity mention labels', () => {
    const blocks: NarrativeBlockLike[] = [
      {
        id: '1',
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Parla con ' },
          { type: 'entityMention', props: { label: 'Marco', entityId: 'abc' } },
        ],
      },
    ];
    expect(blocksToPlainText(blocks)).toContain('Marco');
  });

  it('handles nested children', () => {
    const blocks: NarrativeBlockLike[] = [
      {
        id: '1',
        type: 'paragraph',
        content: [{ type: 'text', text: 'Parent' }],
        children: [
          { id: '2', type: 'paragraph', content: [{ type: 'text', text: 'Child' }] },
        ],
      },
    ];
    const text = blocksToPlainText(blocks);
    expect(text).toContain('Parent');
    expect(text).toContain('Child');
  });

  it('returns empty string for empty blocks', () => {
    expect(blocksToPlainText([])).toBe('');
  });
});

describe('collectNarrativeEntities', () => {
  it('extracts character entities from characterSheet blocks', () => {
    const blocks: NarrativeBlockLike[] = [
      {
        id: 'entity-1',
        type: 'characterSheet',
        props: { entityId: 'uuid-1', characterName: 'Marco Rossi', role: 'protagonist' },
        content: [{ type: 'text', text: 'Background notes' }],
      },
    ];
    const entities = collectNarrativeEntities(blocks);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.name).toBe('Marco Rossi');
    expect(entities[0]!.type).toBe('character');
    expect(entities[0]!.id).toBe('uuid-1');
  });

  it('uses block id as fallback when entityId is empty', () => {
    const blocks: NarrativeBlockLike[] = [
      {
        id: 'block-abc',
        type: 'characterSheet',
        props: { entityId: '', characterName: 'Lucia', role: 'supporting' },
        content: [],
      },
    ];
    const entities = collectNarrativeEntities(blocks);
    expect(entities).toHaveLength(1);
    expect(entities[0]!.id).toBe('block-abc');
  });

  it('returns empty array when no character sheets exist', () => {
    const blocks: NarrativeBlockLike[] = [
      { id: '1', type: 'paragraph', content: [{ type: 'text', text: 'Just text' }] },
    ];
    expect(collectNarrativeEntities(blocks)).toHaveLength(0);
  });

  it('deduplicates entities by entityId', () => {
    const blocks: NarrativeBlockLike[] = [
      {
        id: '1', type: 'characterSheet',
        props: { entityId: 'same-id', characterName: 'Marco', role: 'protagonist' },
        content: [],
      },
      {
        id: '2', type: 'characterSheet',
        props: { entityId: 'same-id', characterName: 'Marco Updated', role: 'protagonist' },
        content: [],
      },
    ];
    const entities = collectNarrativeEntities(blocks);
    expect(entities).toHaveLength(1);
    // Last one wins (Map overwrite)
    expect(entities[0]!.name).toBe('Marco Updated');
  });
});

describe('collectNarrativeAlerts', () => {
  it('extracts alerts from narrativeAlert blocks', () => {
    const blocks: NarrativeBlockLike[] = [
      {
        id: 'alert-1',
        type: 'narrativeAlert',
        props: { severity: 'high', title: 'Timeline inconsistency' },
        content: [{ type: 'text', text: 'The dates do not match' }],
      },
    ];
    const alerts = collectNarrativeAlerts(blocks);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe('high');
    expect(alerts[0]!.title).toBe('Timeline inconsistency');
    expect(alerts[0]!.description).toContain('dates do not match');
  });

  it('returns empty array when no alerts', () => {
    expect(collectNarrativeAlerts([])).toHaveLength(0);
  });
});

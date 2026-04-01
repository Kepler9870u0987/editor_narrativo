import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  filterSuggestionItems,
  insertOrUpdateBlock,
} from '@blocknote/core';
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import type { NarrativeEntity } from '@editor-narrativo/shared';

const characterSheet = createReactBlockSpec(
  {
    type: 'characterSheet',
    propSchema: {
      entityId: { default: '' },
      characterName: { default: 'Nuovo personaggio' },
      role: { default: 'supporting' },
    },
    content: 'inline',
  },
  {
    render: ({ block, contentRef }) => (
      <div className="bn-inline-card bn-inline-card--character" data-block-type="characterSheet">
        <div className="button-row">
          <span className="pill">Scheda personaggio</span>
          <span className="pill">{block.props.role}</span>
        </div>
        <strong>{block.props.characterName}</strong>
        <div ref={contentRef} />
      </div>
    ),
  },
);

const narrativeAlert = createReactBlockSpec(
  {
    type: 'narrativeAlert',
    propSchema: {
      severity: {
        default: 'medium',
        values: ['low', 'medium', 'high'] as const,
      },
      title: { default: 'Alert narrativo' },
    },
    content: 'inline',
  },
  {
    render: ({ block, contentRef }) => (
      <div
        className={`bn-inline-card bn-inline-card--alert bn-inline-card--${block.props.severity}`}
        data-block-type="narrativeAlert"
      >
        <div className="button-row">
          <span className="pill">{block.props.title}</span>
          <span className="pill">{block.props.severity}</span>
        </div>
        <div ref={contentRef} />
      </div>
    ),
  },
);

const toggleSection = createReactBlockSpec(
  {
    type: 'toggleSection',
    propSchema: {
      label: { default: 'Sezione' },
      tone: { default: 'notes' },
    },
    content: 'inline',
  },
  {
    render: ({ block, contentRef }) => (
      <details className="bn-toggle-section" data-block-type="toggleSection" open>
        <summary>
          <span className="pill">{block.props.tone}</span> {block.props.label}
        </summary>
        <div ref={contentRef} />
      </details>
    ),
  },
);

const entityMention = createReactInlineContentSpec(
  {
    type: 'entityMention',
    propSchema: {
      entityId: { default: '' },
      label: { default: 'Entità' },
      entityType: {
        default: 'character',
        values: ['character', 'place', 'item'] as const,
      },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => (
      <span className={`bn-mention bn-mention--${inlineContent.props.entityType}`}>
        @{inlineContent.props.label}
      </span>
    ),
  },
);

export const narrativeSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    characterSheet,
    narrativeAlert,
    toggleSection,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    entityMention,
  },
});

export type NarrativeEditor = any;
export type NarrativePartialBlock = any;

export interface NarrativeBlockLike {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: Array<Record<string, unknown>> | string | undefined;
  children?: NarrativeBlockLike[];
}

function readInlineContent(content: NarrativeBlockLike['content']): string {
  if (!content) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((item) => {
      if (item.type === 'text' && typeof item.text === 'string') {
        return item.text;
      }
      if (item.type === 'link' && Array.isArray(item.content)) {
        return item.content
          .map((child) => (typeof child.text === 'string' ? child.text : ''))
          .join('');
      }
      if (item.type === 'entityMention' && item.props && typeof item.props === 'object') {
        const label = (item.props as Record<string, unknown>).label;
        return typeof label === 'string' ? label : '';
      }
      return '';
    })
    .join('');
}

export function blocksToPlainText(blocks: NarrativeBlockLike[]): string {
  return blocks
    .flatMap((block) => [
      readInlineContent(block.content),
      ...(block.children ? [blocksToPlainText(block.children)] : []),
    ])
    .filter(Boolean)
    .join('\n');
}

export function collectNarrativeEntities(blocks: NarrativeBlockLike[]): NarrativeEntity[] {
  const entities = new Map<string, NarrativeEntity>();

  const visit = (entries: NarrativeBlockLike[]) => {
    for (const block of entries) {
      if (block.type === 'characterSheet') {
        const entityId =
          typeof block.props?.entityId === 'string' && block.props.entityId
            ? block.props.entityId
            : block.id ?? crypto.randomUUID();
        const name =
          typeof block.props?.characterName === 'string' && block.props.characterName
            ? block.props.characterName
            : 'Personaggio';

        entities.set(entityId, {
          id: entityId,
          name,
          type: 'character',
          metadata: {
            role: block.props?.role ?? 'supporting',
            note: readInlineContent(block.content),
          },
        });
      }
      if (block.children?.length) {
        visit(block.children);
      }
    }
  };

  visit(blocks);
  return Array.from(entities.values());
}

export function collectNarrativeAlerts(blocks: NarrativeBlockLike[]): Array<{
  id: string;
  title: string;
  severity: string;
  description: string;
}> {
  const result: Array<{
    id: string;
    title: string;
    severity: string;
    description: string;
  }> = [];

  const visit = (entries: NarrativeBlockLike[]) => {
    for (const block of entries) {
      if (block.type === 'narrativeAlert') {
        result.push({
          id: block.id ?? crypto.randomUUID(),
          title:
            typeof block.props?.title === 'string' ? block.props.title : 'Alert narrativo',
          severity:
            typeof block.props?.severity === 'string' ? block.props.severity : 'medium',
          description: readInlineContent(block.content),
        });
      }
      if (block.children?.length) {
        visit(block.children);
      }
    }
  };

  visit(blocks);
  return result;
}

export function getNarrativeSlashMenuItems(editor: NarrativeEditor): DefaultReactSuggestionItem[] {
  const baseItems = getDefaultReactSlashMenuItems(editor);
  const customItems: DefaultReactSuggestionItem[] = [
    {
      title: 'Scheda personaggio',
      subtext: 'Inserisce una scheda strutturata per personaggi',
      aliases: ['character', 'personaggio', 'scheda'],
      group: 'Narrativa',
      onItemClick: () => {
        insertOrUpdateBlock(editor, {
          type: 'characterSheet',
          props: {
            entityId: crypto.randomUUID(),
            characterName: 'Nuovo personaggio',
            role: 'supporting',
          },
        } as NarrativePartialBlock);
      },
    },
    {
      title: 'Alert narrativo',
      subtext: 'Aggiunge un alert riusabile per conflitti e note AI',
      aliases: ['alert', 'conflitto', 'logic'],
      group: 'Narrativa',
      onItemClick: () => {
        insertOrUpdateBlock(editor, {
          type: 'narrativeAlert',
          props: {
            severity: 'medium',
            title: 'Alert narrativo',
          },
        } as NarrativePartialBlock);
      },
    },
    {
      title: 'Sezione toggle',
      subtext: 'Crea una sezione comprimibile per la story bible',
      aliases: ['toggle', 'section', 'story bible'],
      group: 'Narrativa',
      onItemClick: () => {
        insertOrUpdateBlock(editor, {
          type: 'toggleSection',
          props: {
            label: 'Nuova sezione',
            tone: 'notes',
          },
        } as NarrativePartialBlock);
      },
    },
  ];

  return [...baseItems, ...customItems];
}

export function getMentionMenuItems(
  editor: NarrativeEditor,
  entities: NarrativeEntity[],
  query: string,
): DefaultReactSuggestionItem[] {
  return filterSuggestionItems(
    entities.map((entity) => ({
      title: entity.name,
      subtext: `${entity.type} • ${entity.id.slice(0, 8)}`,
      aliases: [entity.type, entity.id],
      group: 'Entità',
      onItemClick: () => {
        editor.insertInlineContent([
          {
            type: 'entityMention',
            props: {
              entityId: entity.id,
              label: entity.name,
              entityType: entity.type,
            },
          },
          ' ',
        ]);
      },
    })),
    query,
  );
}

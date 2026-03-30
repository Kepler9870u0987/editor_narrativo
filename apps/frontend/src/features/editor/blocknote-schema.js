import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, filterSuggestionItems, insertOrUpdateBlock, } from '@blocknote/core';
import { BlockContentWrapper, InlineContentWrapper, createReactBlockSpec, createReactInlineContentSpec, getDefaultReactSlashMenuItems, } from '@blocknote/react';
const characterSheet = createReactBlockSpec({
    type: 'characterSheet',
    propSchema: {
        entityId: { default: '' },
        characterName: { default: 'Nuovo personaggio' },
        role: { default: 'supporting' },
    },
    content: 'inline',
}, {
    render: ({ block, contentRef }) => (_jsx(BlockContentWrapper, { block: block, blockType: "characterSheet", children: _jsxs("div", { className: "bn-inline-card bn-inline-card--character", children: [_jsxs("div", { className: "button-row", children: [_jsx("span", { className: "pill", children: "Scheda personaggio" }), _jsx("span", { className: "pill", children: block.props.role })] }), _jsx("strong", { children: block.props.characterName }), _jsx("div", { ref: contentRef })] }) })),
});
const narrativeAlert = createReactBlockSpec({
    type: 'narrativeAlert',
    propSchema: {
        severity: {
            default: 'medium',
            values: ['low', 'medium', 'high'],
        },
        title: { default: 'Alert narrativo' },
    },
    content: 'inline',
}, {
    render: ({ block, contentRef }) => (_jsx(BlockContentWrapper, { block: block, blockType: "narrativeAlert", children: _jsxs("div", { className: `bn-inline-card bn-inline-card--alert bn-inline-card--${block.props.severity}`, children: [_jsxs("div", { className: "button-row", children: [_jsx("span", { className: "pill", children: block.props.title }), _jsx("span", { className: "pill", children: block.props.severity })] }), _jsx("div", { ref: contentRef })] }) })),
});
const toggleSection = createReactBlockSpec({
    type: 'toggleSection',
    propSchema: {
        label: { default: 'Sezione' },
        tone: { default: 'notes' },
    },
    content: 'inline',
}, {
    render: ({ block, contentRef }) => (_jsx(BlockContentWrapper, { block: block, blockType: "toggleSection", children: _jsxs("details", { className: "bn-toggle-section", open: true, children: [_jsxs("summary", { children: [_jsx("span", { className: "pill", children: block.props.tone }), " ", block.props.label] }), _jsx("div", { ref: contentRef })] }) })),
});
const entityMention = createReactInlineContentSpec({
    type: 'entityMention',
    propSchema: {
        entityId: { default: '' },
        label: { default: 'Entità' },
        entityType: {
            default: 'character',
            values: ['character', 'place', 'item'],
        },
    },
    content: 'none',
}, {
    render: ({ inlineContent }) => (_jsx(InlineContentWrapper, { inlineContentProps: inlineContent.props, inlineContentType: "entityMention", children: _jsxs("span", { className: `bn-mention bn-mention--${inlineContent.props.entityType}`, children: ["@", inlineContent.props.label] }) })),
});
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
function readInlineContent(content) {
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
            const label = item.props.label;
            return typeof label === 'string' ? label : '';
        }
        return '';
    })
        .join('');
}
export function blocksToPlainText(blocks) {
    return blocks
        .flatMap((block) => [
        readInlineContent(block.content),
        ...(block.children ? [blocksToPlainText(block.children)] : []),
    ])
        .filter(Boolean)
        .join('\n');
}
export function collectNarrativeEntities(blocks) {
    const entities = new Map();
    const visit = (entries) => {
        for (const block of entries) {
            if (block.type === 'characterSheet') {
                const entityId = typeof block.props?.entityId === 'string' && block.props.entityId
                    ? block.props.entityId
                    : block.id ?? crypto.randomUUID();
                const name = typeof block.props?.characterName === 'string' && block.props.characterName
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
export function collectNarrativeAlerts(blocks) {
    const result = [];
    const visit = (entries) => {
        for (const block of entries) {
            if (block.type === 'narrativeAlert') {
                result.push({
                    id: block.id ?? crypto.randomUUID(),
                    title: typeof block.props?.title === 'string' ? block.props.title : 'Alert narrativo',
                    severity: typeof block.props?.severity === 'string' ? block.props.severity : 'medium',
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
export function getNarrativeSlashMenuItems(editor) {
    const baseItems = getDefaultReactSlashMenuItems(editor);
    const customItems = [
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
                });
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
                });
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
                });
            },
        },
    ];
    return [...baseItems, ...customItems];
}
export function getMentionMenuItems(editor, entities, query) {
    return filterSuggestionItems(entities.map((entity) => ({
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
    })), query);
}
//# sourceMappingURL=blocknote-schema.js.map
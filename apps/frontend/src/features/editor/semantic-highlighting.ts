/**
 * Semantic Highlighting — Applies visual inline markers on text
 * identified as conflicting by the Logic Check system.
 *
 * Uses the underlying Tiptap/ProseMirror editor to programmatically
 * apply and remove conflict marks without disrupting the document model.
 *
 * Severity levels:
 *   - high:   red background — logical/causal violations
 *   - medium: orange background — detail/tone inconsistencies
 *   - low:    yellow background — minor descriptive discrepancies
 */

import type { LogicCheckResponse } from '@editor-narrativo/shared';

/**
 * CSS class names for conflict highlights.
 * These are applied via ProseMirror decorations to avoid mutating the document.
 */
const HIGHLIGHT_CLASSES: Record<string, string> = {
  high: 'conflict-highlight conflict-highlight--high',
  medium: 'conflict-highlight conflict-highlight--medium',
  low: 'conflict-highlight conflict-highlight--low',
};

interface HighlightRange {
  from: number;
  to: number;
  severity: string;
  description: string;
}

/**
 * Search for text occurrences in the ProseMirror document and return
 * position ranges for each match.
 */
function findTextInDoc(
  doc: any,
  searchText: string,
): Array<{ from: number; to: number }> {
  const results: Array<{ from: number; to: number }> = [];
  if (!searchText || searchText.length < 8) return results;

  // Normalize search text: take first meaningful sentence/clause
  const normalized = searchText
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  // Extract key phrases (at least 8 chars) for fuzzy matching
  const phrases = extractKeyPhrases(normalized);
  if (phrases.length === 0) return results;

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text = node.text as string;
    const lowerText = text.toLowerCase();

    for (const phrase of phrases) {
      const lowerPhrase = phrase.toLowerCase();
      let startIdx = 0;

      while (startIdx < lowerText.length) {
        const idx = lowerText.indexOf(lowerPhrase, startIdx);
        if (idx === -1) break;

        results.push({
          from: pos + idx,
          to: pos + idx + phrase.length,
        });
        startIdx = idx + phrase.length;
      }
    }
  });

  return results;
}

/**
 * Extract meaningful key phrases from a statement for text matching.
 * Takes noun phrases and significant clauses that are likely to appear
 * verbatim in the document.
 */
function extractKeyPhrases(text: string): string[] {
  const phrases: string[] = [];

  // Split on sentence boundaries and punctuation
  const parts = text.split(/[.,:;!?\-—]+/).map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    // Only use phrases with enough specificity
    if (part.length >= 10 && part.length <= 120) {
      phrases.push(part);
    }
  }

  // If no good phrases found, try individual long words as fallback
  if (phrases.length === 0) {
    const words = text.split(/\s+/).filter((w) => w.length >= 6);
    // Group consecutive significant words
    if (words.length >= 2) {
      for (let i = 0; i < words.length - 1; i++) {
        phrases.push(`${words[i]} ${words[i + 1]}`);
      }
    }
  }

  return phrases.slice(0, 5); // Limit to avoid excessive searching
}

/**
 * Compute highlight ranges from a LogicCheckResponse by matching
 * evidence chain scene statements against the document text.
 */
export function computeHighlightRanges(
  tiptapEditor: any,
  result: LogicCheckResponse,
): HighlightRange[] {
  if (!result.hasConflict || !tiptapEditor) return [];

  const doc = tiptapEditor.state.doc;
  const ranges: HighlightRange[] = [];

  for (const conflict of result.conflicts) {
    // Try to find the conflict description text in the document
    const matches = findTextInDoc(doc, conflict.description);
    for (const match of matches) {
      ranges.push({
        ...match,
        severity: conflict.severity,
        description: conflict.description,
      });
    }
  }

  for (const chain of result.evidence_chains) {
    // Match scene statements — these are most likely to appear in the text
    const matches = findTextInDoc(doc, chain.sceneStatement);
    const severity = result.conflicts.length > 0
      ? result.conflicts[0]!.severity
      : 'medium';

    for (const match of matches) {
      ranges.push({
        ...match,
        severity,
        description: chain.contradiction,
      });
    }
  }

  // Deduplicate overlapping ranges
  return deduplicateRanges(ranges);
}

function deduplicateRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length <= 1) return ranges;

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  const merged: HighlightRange[] = [ranges[0]!];
  for (let i = 1; i < ranges.length; i++) {
    const current = ranges[i]!;
    const last = merged[merged.length - 1]!;

    if (current.from <= last.to) {
      // Overlapping — keep the higher severity
      const severityOrder = { high: 3, medium: 2, low: 1 };
      const lastSev = severityOrder[last.severity as keyof typeof severityOrder] ?? 1;
      const currSev = severityOrder[current.severity as keyof typeof severityOrder] ?? 1;

      last.to = Math.max(last.to, current.to);
      if (currSev > lastSev) {
        last.severity = current.severity;
        last.description = current.description;
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Apply semantic highlight decorations to the editor.
 * Uses ProseMirror Decoration plugin to overlay without mutating content.
 */
export function applySemanticHighlights(
  tiptapEditor: any,
  result: LogicCheckResponse | null,
): void {
  if (!tiptapEditor) return;

  const { Plugin, PluginKey } = tiptapEditor.state.constructor;
  // Access ProseMirror via Tiptap
  const pmView = tiptapEditor.view;
  if (!pmView) return;

  const pluginKey = new PluginKey('semanticHighlight');

  // Remove existing plugin if present
  const existingPlugin = pmView.state.plugins.find(
    (p: any) => p.spec.key === pluginKey,
  );

  if (!result || !result.hasConflict) {
    // Clear highlights
    if (existingPlugin) {
      const { state } = pmView;
      const newPlugins = state.plugins.filter((p: any) => p.spec.key !== pluginKey);
      const newState = state.reconfigure({ plugins: newPlugins });
      pmView.updateState(newState);
    }
    return;
  }

  const ranges = computeHighlightRanges(tiptapEditor, result);
  if (ranges.length === 0) return;

  // Import Decoration from prosemirror-view
  const { Decoration, DecorationSet } = require('prosemirror-view');

  const decorations = ranges.map((range) =>
    Decoration.inline(range.from, range.to, {
      class: HIGHLIGHT_CLASSES[range.severity] ?? HIGHLIGHT_CLASSES.medium,
      title: range.description,
    }),
  );

  const plugin = new Plugin({
    key: pluginKey,
    props: {
      decorations: () => DecorationSet.create(pmView.state.doc, decorations),
    },
  });

  // Add plugin to editor
  const { state } = pmView;
  const newPlugins = [
    ...state.plugins.filter((p: any) => p.spec.key !== pluginKey),
    plugin,
  ];
  const newState = state.reconfigure({ plugins: newPlugins });
  pmView.updateState(newState);
}

/**
 * Clear all semantic highlights from the editor.
 */
export function clearSemanticHighlights(tiptapEditor: any): void {
  applySemanticHighlights(tiptapEditor, null);
}

/**
 * Prompt Builder — Constructs the logic-check prompt for plot hole detection.
 *
 * Forces the LLM into the role of "Revisore Analitico" with:
 * 1. Fact Extraction: decompose the scene into atomic statements
 * 2. Cross-Reference: compare with Story Bible passages (RAG context)
 * 3. JSON Output: structured response with evidence_chains
 */

import type { LogicCheckRequest, LogicCheckResponse } from '@editor-narrativo/shared';

const SYSTEM_PROMPT = `Sei un Revisore Analitico esperto in coerenza narrativa. Il tuo compito è identificare "Plot Hole" (contraddizioni logiche) tra una nuova scena e la Story Bible dell'opera.

ISTRUZIONI RIGOROSE:
1. FASE 1 — FACT EXTRACTION: Scomponi la scena dell'autore in preposizioni atomiche (fatti puri). Elimina la verbosità retorica. Ogni fatto deve essere una singola affermazione verificabile.
2. FASE 2 — CROSS-REFERENCE: Confronta OGNI fatto atomico con i passaggi della Story Bible forniti nel contesto. Cerca contraddizioni dirette, impossibilità temporali, incoerenze di stato dei personaggi.
3. FASE 3 — JSON OUTPUT: Rispondi ESCLUSIVAMENTE in formato JSON valido. Nessun testo prima o dopo il JSON.

Il JSON deve avere ESATTAMENTE questa struttura:
{
  "hasConflict": boolean,
  "conflicts": [
    {
      "description": "descrizione chiara della contraddizione",
      "severity": "low" | "medium" | "high"
    }
  ],
  "evidence_chains": [
    {
      "sceneStatement": "fatto atomico dalla scena",
      "bibleExcerpt": "citazione letterale dalla Story Bible",
      "contradiction": "spiegazione della contraddizione"
    }
  ]
}

Se NON trovi contraddizioni, rispondi con: {"hasConflict": false, "conflicts": [], "evidence_chains": []}`;

/**
 * Build the full prompt payload for the LLM API call.
 */
export function buildLogicCheckPrompt(request: LogicCheckRequest): Array<{
  role: 'system' | 'user';
  content: string;
}> {
  const ragContextBlock = request.ragContext.length > 0
    ? `\n\n--- STORY BIBLE (passaggi rilevanti) ---\n${request.ragContext.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}\n--- FINE STORY BIBLE ---`
    : '\n\n--- STORY BIBLE ---\nNessun passaggio disponibile.\n--- FINE STORY BIBLE ---';

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Analizza la seguente scena per contraddizioni con la Story Bible.

--- SCENA DELL'AUTORE ---
${request.sceneText}
--- FINE SCENA ---${ragContextBlock}`,
    },
  ];
}

/**
 * Parse and validate the LLM response JSON.
 * Returns null if the response is not valid JSON or doesn't match the schema.
 */
export function parseLogicCheckResponse(
  rawResponse: string,
): LogicCheckResponse | null {
  try {
    // Try to extract JSON from the response (LLM might wrap it in markdown)
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    if (typeof parsed.hasConflict !== 'boolean') return null;
    if (!Array.isArray(parsed.conflicts)) return null;
    if (!Array.isArray(parsed.evidence_chains)) return null;

    // Validate conflict items
    for (const c of parsed.conflicts) {
      if (typeof c !== 'object' || c === null) return null;
      const conflict = c as Record<string, unknown>;
      if (typeof conflict.description !== 'string') return null;
      if (!['low', 'medium', 'high'].includes(conflict.severity as string)) return null;
    }

    // Validate evidence chain items
    for (const e of parsed.evidence_chains) {
      if (typeof e !== 'object' || e === null) return null;
      const evidence = e as Record<string, unknown>;
      if (typeof evidence.sceneStatement !== 'string') return null;
      if (typeof evidence.bibleExcerpt !== 'string') return null;
      if (typeof evidence.contradiction !== 'string') return null;
    }

    return parsed as unknown as LogicCheckResponse;
  } catch {
    return null;
  }
}

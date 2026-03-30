import { chunkText } from '@editor-narrativo/rag';
import { decryptJsonSnapshot } from '../../lib/keys';
import { editorDb } from '../../lib/storage';
import { blocksToPlainText } from './blocknote-schema';
function normalizeTerms(value) {
    return value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .filter((term) => term.length >= 4);
}
function scoreChunk(query, chunk) {
    const queryTerms = new Set(normalizeTerms(query));
    if (queryTerms.size === 0) {
        return 0;
    }
    const chunkTerms = normalizeTerms(chunk);
    let matches = 0;
    for (const term of chunkTerms) {
        if (queryTerms.has(term)) {
            matches += 1;
        }
    }
    return matches / Math.max(1, queryTerms.size);
}
export async function buildLocalRagContext(query, textEncryptionKey, excludeDocumentId) {
    const docs = await editorDb.documents.toArray();
    const ranked = [];
    for (const doc of docs) {
        if (doc.id === excludeDocumentId || (doc.kind !== 'story_bible' && doc.kind !== 'notes')) {
            continue;
        }
        const snapshot = await editorDb.snapshots.get(doc.id);
        if (!snapshot) {
            continue;
        }
        try {
            const blocks = await decryptJsonSnapshot(textEncryptionKey, snapshot.encryptedBlob);
            const plainText = blocksToPlainText(blocks);
            for (const chunk of chunkText(plainText, 1200, 80)) {
                const score = scoreChunk(query, chunk);
                if (score > 0) {
                    ranked.push({ score, text: chunk });
                }
            }
        }
        catch {
            // Ignore corrupted local cache entries and keep retrieval resilient.
        }
    }
    return ranked
        .sort((left, right) => right.score - left.score)
        .slice(0, 6)
        .map((entry) => entry.text);
}
//# sourceMappingURL=rag-context.js.map
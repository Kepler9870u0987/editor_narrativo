import type { CreateDocumentRequest, DocumentSummary, EncryptedDocumentSnapshot, EncryptedDocumentUpdate, MissingUpdatesResponse, UpdateDocumentRequest } from '@editor-narrativo/documents-shared';
export declare const documentsApi: {
    create(accessToken: string, payload: CreateDocumentRequest): Promise<DocumentSummary>;
    list(accessToken: string): Promise<DocumentSummary[]>;
    get(accessToken: string, documentId: string): Promise<DocumentSummary>;
    update(accessToken: string, documentId: string, patch: UpdateDocumentRequest): Promise<DocumentSummary>;
    getSnapshot(accessToken: string, documentId: string): Promise<EncryptedDocumentSnapshot>;
    putSnapshot(accessToken: string, documentId: string, snapshot: EncryptedDocumentSnapshot): Promise<{
        saved: boolean;
    }>;
    getUpdates(accessToken: string, documentId: string, afterClock: number): Promise<MissingUpdatesResponse>;
    postUpdates(accessToken: string, documentId: string, updates: EncryptedDocumentUpdate[]): Promise<{
        accepted: number;
        latestClock: number;
    }>;
};
//# sourceMappingURL=documents-api.d.ts.map
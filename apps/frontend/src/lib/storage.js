import Dexie from 'dexie';
export class EditorDatabase extends Dexie {
    documents;
    snapshots;
    pendingUpdates;
    constructor() {
        super('editor-narrativo');
        this.version(1).stores({
            documents: '&id, updatedAt, kind, syncState',
            snapshots: '&documentId, updatedAt',
            pendingUpdates: '&updateId, documentId, clock',
        });
    }
}
export const editorDb = new EditorDatabase();
//# sourceMappingURL=storage.js.map
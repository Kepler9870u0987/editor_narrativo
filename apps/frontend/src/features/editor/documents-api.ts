import type {
  CreateDocumentRequest,
  DocumentSummary,
  EncryptedDocumentSnapshot,
  EncryptedDocumentUpdate,
  MissingUpdatesResponse,
  UpdateDocumentRequest,
} from '@editor-narrativo/documents-shared';
import { appEnv } from '../../lib/env';
import { apiFetch } from '../../lib/http';

function url(path: string): string {
  return `${appEnv.documentsBasePath}${path}`;
}

export const documentsApi = {
  create(accessToken: string, payload: CreateDocumentRequest) {
    return apiFetch<DocumentSummary>(url('/documents'), {
      method: 'POST',
      accessToken,
      body: payload,
    });
  },
  list(accessToken: string) {
    return apiFetch<DocumentSummary[]>(url('/documents'), { accessToken });
  },
  get(accessToken: string, documentId: string) {
    return apiFetch<DocumentSummary>(url(`/documents/${documentId}`), { accessToken });
  },
  update(accessToken: string, documentId: string, patch: UpdateDocumentRequest) {
    return apiFetch<DocumentSummary>(url(`/documents/${documentId}`), {
      method: 'PATCH',
      accessToken,
      body: patch,
    });
  },
  getSnapshot(accessToken: string, documentId: string) {
    return apiFetch<EncryptedDocumentSnapshot>(url(`/documents/${documentId}/snapshot`), {
      accessToken,
    });
  },
  putSnapshot(accessToken: string, documentId: string, snapshot: EncryptedDocumentSnapshot) {
    return apiFetch<{ saved: boolean }>(url(`/documents/${documentId}/snapshot`), {
      method: 'PUT',
      accessToken,
      body: { snapshot },
    });
  },
  getUpdates(accessToken: string, documentId: string, afterClock: number) {
    return apiFetch<MissingUpdatesResponse>(url(`/documents/${documentId}/updates?afterClock=${afterClock}`), {
      accessToken,
    });
  },
  postUpdates(accessToken: string, documentId: string, updates: EncryptedDocumentUpdate[]) {
    return apiFetch<{ accepted: number; latestClock: number }>(url(`/documents/${documentId}/updates/batch`), {
      method: 'POST',
      accessToken,
      body: { updates },
    });
  },
};

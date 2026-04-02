/**
 * Zod validation schemas for documents-backend REST endpoints.
 */

import { z } from 'zod';

export const CreateDocumentRequestSchema = z.object({
  title: z.string().trim().min(1).max(500),
  kind: z.enum(['manuscript', 'story_bible', 'notes']),
}).strict();

export const UpdateDocumentRequestSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  archived: z.boolean().optional(),
}).strict();

const encryptedPayload = z.object({
  documentId: z.string().uuid(),
  snapshotId: z.string().min(1).max(256).optional(),
  updateId: z.string().min(1).max(256).optional(),
  encryptedData: z.string().min(1).max(10_000_000),
  iv: z.string().min(1).max(512),
  signature: z.string().min(1).max(2048),
  publicKey: z.string().min(1).max(2048),
  clock: z.number().int().nonnegative(),
  createdAt: z.string().min(1).max(64),
});

export const PutSnapshotRequestSchema = z.object({
  snapshot: encryptedPayload.extend({
    snapshotId: z.string().min(1).max(256),
  }),
}).strict();

export const PostUpdatesBatchRequestSchema = z.object({
  updates: z.array(
    encryptedPayload.extend({
      updateId: z.string().min(1).max(256),
    }),
  ).min(1).max(100),
}).strict();

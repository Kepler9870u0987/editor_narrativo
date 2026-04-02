/**
 * Zod validation schemas for all account-backend REST endpoints.
 *
 * Replaces manual parseXxxRequest() functions with strict schema validation
 * including length limits, format checks, and sanitization.
 */

import { z } from 'zod';

// ── Shared field schemas ───────────────────────────────────

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(320)
  .email('Invalid email address');

const passwordField = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(1024);

const displayNameField = z
  .string()
  .trim()
  .max(200)
  .optional();

const base64Field = z
  .string()
  .min(1)
  .max(16_384);

const deviceNameField = z
  .string()
  .trim()
  .max(200)
  .optional();

const totpCodeField = z
  .string()
  .regex(/^\d{6}$/, 'TOTP code must be 6 digits');

const recoveryCodeField = z
  .string()
  .min(1)
  .max(64);

// ── Request schemas ────────────────────────────────────────

export const RegisterRequestSchema = z.object({
  email: emailField,
  password: passwordField,
  displayName: displayNameField,
}).strict();

export const VerifyEmailRequestSchema = z.object({
  email: emailField,
  token: z.string().min(1).max(512),
}).strict();

export const LoginRequestSchema = z.object({
  email: emailField,
  password: passwordField,
  totpCode: totpCodeField.optional(),
  recoveryCode: recoveryCodeField.optional(),
  deviceName: deviceNameField,
}).strict();

export const ForgotPasswordRequestSchema = z.object({
  email: emailField,
}).strict();

export const ResetPasswordRequestSchema = z.object({
  email: emailField,
  token: z.string().min(1).max(512),
  newPassword: passwordField,
}).strict();

export const UpdateProfileRequestSchema = z.object({
  displayName: displayNameField,
}).strict();

export const BootstrapKeysRequestSchema = z.object({
  wrappedDek: base64Field,
  argon2Salt: base64Field,
  wrappedSigningSecretKey: base64Field,
  signingPublicKey: base64Field,
  kekVersion: z.number().int().nonnegative(),
  recoveryKit: z.string().max(65_536).nullable().optional(),
}).strict();

export const TotpVerifyRequestSchema = z.object({
  code: totpCodeField,
}).strict();

const passkeyResponseSchema = z.object({
  clientDataJSON: z.string().min(1).max(16_384),
  attestationObject: z.string().min(1).max(65_536).optional(),
  authenticatorData: z.string().min(1).max(16_384).optional(),
  signature: z.string().min(1).max(16_384).optional(),
  userHandle: z.string().max(512).nullable().optional(),
  transports: z.array(z.string().max(64)).max(10).optional(),
});

export const PasskeyRegisterFinishRequestSchema = z.object({
  credential: z.object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: z.string().min(1).max(16_384),
      attestationObject: z.string().min(1).max(65_536),
      transports: z.array(z.string().max(64)).max(10).optional(),
    }),
  }),
}).strict();

export const PasskeyLoginStartRequestSchema = z.object({
  email: emailField,
}).strict();

export const PasskeyLoginFinishRequestSchema = z.object({
  email: emailField,
  deviceName: deviceNameField,
  credential: z.object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: z.string().min(1).max(16_384),
      authenticatorData: z.string().min(1).max(16_384),
      signature: z.string().min(1).max(16_384),
      userHandle: z.string().max(512).nullable().optional(),
    }),
  }),
}).strict();

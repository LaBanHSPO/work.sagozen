import type { Request } from 'express';
import { z } from 'zod';

import { getRequestCookie } from '../../base';

export const SESSION_COOKIE_NAME = 'affine_session';
export const USER_COOKIE_NAME = 'affine_user_id';
export const CSRF_COOKIE_NAME = 'affine_csrf_token';

export const BearerHeaderSchema = z
  .string()
  .regex(/^Bearer\s+\S+$/i)
  .transform(value => value.replace(/^Bearer\s+/i, ''));

export function extractTokenFromHeader(authorization: string) {
  const parsed = BearerHeaderSchema.safeParse(authorization);
  return parsed.success ? parsed.data : undefined;
}

export const SessionIdSchema = z.string().uuid();

export const UserIdSchema = z.union([
  z.string().uuid(),
  z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
]);

const EmailSchema = z.string().max(320);
const ClientNonceSchema = z.string().min(1).max(512);
const ChallengeTokenSchema = z.string().min(1).max(512);

export const AuthPreflightBodySchema = z
  .object({ email: EmailSchema })
  .strict();

export const SignInBodySchema = z
  .object({
    email: EmailSchema,
    password: z.string().min(1).max(1024).optional(),
    callbackUrl: z.string().min(1).max(2048).optional(),
    client_nonce: ClientNonceSchema.optional(),
  })
  .strict();

export const MagicLinkBodySchema = z
  .object({
    email: EmailSchema,
    token: ChallengeTokenSchema,
    client_nonce: ClientNonceSchema.optional(),
  })
  .strict();

export function getSessionOptionsFromRequest(req: Request) {
  const sessionId = SessionIdSchema.safeParse(
    getRequestCookie(req, SESSION_COOKIE_NAME)
  );
  const userId = UserIdSchema.safeParse(
    getRequestCookie(req, USER_COOKIE_NAME)
  );

  return {
    sessionId: sessionId.success ? sessionId.data : undefined,
    userId: userId.success ? userId.data : undefined,
  };
}


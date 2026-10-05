import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { getClientVersionFromRequest, getRequestCookie } from '../../base';
import { AuthService } from './service';
import type { CurrentUser } from './session';

export type SessionIssueInput = {
  type: 'cookie';
  sessionId?: string;
  clientVersion?: string;
};

export type LoginResult = {
  user: CurrentUser;
  sessionId: string;
  sessionExpiresAt: string;
  created?: boolean;
};

@Injectable()
export class SessionIssuer {
  constructor(private readonly auth: AuthService) {}

  target(req: Request, clientVersion?: string): SessionIssueInput {
    const version =
      clientVersion ?? getClientVersionFromRequest(req) ?? undefined;
    return {
      type: 'cookie',
      sessionId: getRequestCookie(req, AuthService.sessionCookieName),
      clientVersion: version,
    };
  }

  apply(res: Response, result: LoginResult) {
    const expires = new Date(result.sessionExpiresAt);
    res.cookie(AuthService.sessionCookieName, result.sessionId, {
      ...this.auth.cookieOptions,
      expires,
    });
    res.cookie(AuthService.csrfCookieName, randomUUID(), {
      ...this.auth.cookieOptions,
      httpOnly: false,
      expires,
    });
    this.auth.setUserCookie(res, result.user.id);
  }
}

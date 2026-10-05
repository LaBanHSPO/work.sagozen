import { HttpStatus, Injectable } from '@nestjs/common';

import { EventBus, metrics, OnEvent, UserFriendlyError } from '../../base';
import { BackendRuntimeProvider } from '../backend-runtime';

export class AuthSessionHttpError extends UserFriendlyError {
  readonly authCode: string;

  constructor(code: string, status = HttpStatus.UNAUTHORIZED) {
    super(
      status === HttpStatus.SERVICE_UNAVAILABLE
        ? 'network_error'
        : 'authentication_required',
      code.toLowerCase() as
        | 'access_token_expired'
        | 'access_token_invalid'
        | 'auth_session_expired'
        | 'auth_session_revoked'
        | 'auth_session_temporarily_unavailable'
    );
    this.authCode = code;
    this.status = status;
  }

  override toJSON() {
    return { ...super.toJSON(), code: this.authCode };
  }
}

declare global {
  interface Events {
    'auth.session.revoked': { authSessionId: string; reason: string };
    'auth.security.detected': {
      type: 'sessions_revoked';
      userId: string;
      authSessionId?: string;
      reason?: string;
      notification: 'policy_pending' | 'none';
    };
    'auth.sessions.revoke_requested': { userId: string; reason: string };
  }
}

export interface AuthSessionListItem {
  id: string;
  installationId: string;
  platform: string;
  deviceName?: string;
  appVersion?: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date;
  revokeReason?: string;
}

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly rt: BackendRuntimeProvider,
    private readonly event: EventBus
  ) {}

  async revoke(id: string, reason: string, userId?: string) {
    const revoked = await this.rt.executeAuthSessionCommandV1<boolean>({
      action: 'revoke_session',
      authSessionId: id,
      userId,
      reason,
    });
    if (revoked) {
      metrics.auth.counter('auth_session_revoked').add(1, { reason });
      this.event.emit('auth.session.revoked', { authSessionId: id, reason });
    }
    return revoked;
  }

  async revokeUserSessions(userId: string, reason: string) {
    const count = await this.rt.executeAuthSessionCommandV1<number>({
      action: 'revoke_user',
      userId,
      reason,
    });
    if (count) {
      metrics.auth.counter('auth_session_revoked').add(count, { reason });
      this.event.emit('auth.security.detected', {
        type: 'sessions_revoked',
        userId,
        reason,
        notification: 'none',
      });
    }
    return count;
  }

  @OnEvent('user.preDelete')
  async onUserPreDelete({ id }: Events['user.preDelete']) {
    await this.revokeUserSessions(id, 'user_deleted_or_disabled');
  }

  async list(userId: string): Promise<AuthSessionListItem[]> {
    type EncodedItem = Omit<
      AuthSessionListItem,
      | 'createdAt'
      | 'lastSeenAt'
      | 'idleExpiresAt'
      | 'absoluteExpiresAt'
      | 'revokedAt'
    > & {
      createdAt: string;
      lastSeenAt: string;
      idleExpiresAt: string;
      absoluteExpiresAt: string;
      revokedAt?: string;
    };
    const items = await this.rt.executeAuthSessionCommandV1<EncodedItem[]>({
      action: 'list',
      userId,
    });
    return items.map(item => ({
      ...item,
      createdAt: new Date(item.createdAt),
      lastSeenAt: new Date(item.lastSeenAt),
      idleExpiresAt: new Date(item.idleExpiresAt),
      absoluteExpiresAt: new Date(item.absoluteExpiresAt),
      revokedAt: item.revokedAt ? new Date(item.revokedAt) : undefined,
    }));
  }

  async cleanup(limit = 1000) {
    return await this.rt.executeAuthSessionCommandV1<number>({
      action: 'cleanup',
      limit,
    });
  }
}

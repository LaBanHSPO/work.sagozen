import { AuthSession } from '@affine/core/modules/cloud/entities/session';
import { AuthService } from '@affine/core/modules/cloud/services/auth';
import { FetchService } from '@affine/core/modules/cloud/services/fetch';
import { ServerService } from '@affine/core/modules/cloud/services/server';
import { AuthStore } from '@affine/core/modules/cloud/stores/auth';
import { GlobalDialogService } from '@affine/core/modules/dialogs/services/dialog';
import { NbstoreService } from '@affine/core/modules/storage';
import { ServerDeploymentType } from '@affine/graphql';
import { Framework } from '@toeverything/infra';
import { of } from 'rxjs';
import { describe, expect, test, vi } from 'vitest';

describe('AuthService browser password sign-in', () => {
  test('waits for the session bootstrap before completing', async () => {
      let resolveSession!: () => void;
      const revalidateOnce = vi.fn(
        () =>
          new Promise<void>(resolve => {
            resolveSession = resolve;
          })
      );
      const signInPassword = vi.fn().mockResolvedValue(undefined);
      const framework = new Framework();

      framework.entity(
        AuthSession,
        () =>
          ({
            account$: of(null),
            revalidate: vi.fn(),
            revalidateOnce,
          }) as unknown as AuthSession
      );
      framework.service(FetchService, { fetch: vi.fn() } as unknown as FetchService);
      framework.store(AuthStore, {
        signInPassword,
        setCachedSignInUser: vi.fn(),
      } as unknown as AuthStore);
      framework.service(GlobalDialogService, { open: vi.fn() } as unknown as GlobalDialogService);
      framework.service(NbstoreService, {
        realtime: { subscribe: () => of() },
      } as unknown as NbstoreService);
      framework.service(ServerService, {
        server: {
          ['config$']: {
            value: {
              type: ServerDeploymentType.Selfhosted,
              version: '0.27.2',
            },
          },
        },
      } as unknown as ServerService);
      framework.service(AuthService, [
        FetchService,
        AuthStore,
        GlobalDialogService,
        NbstoreService,
        ServerService,
      ]);

      const auth = framework.provider().get(AuthService);
      let completed = false;
      const signInPromise = auth
        .signInPassword({
          email: 'user@example.com',
          password: 'password',
        })
        .then(() => {
          completed = true;
        });

      await vi.waitFor(() => expect(revalidateOnce).toHaveBeenCalledOnce());
      expect(completed).toBe(false);
      resolveSession();
      await signInPromise;

      expect(signInPassword).toHaveBeenCalledOnce();
      expect(completed).toBe(true);
  });
});

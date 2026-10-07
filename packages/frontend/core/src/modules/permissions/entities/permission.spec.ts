import { Framework, LiveData } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import { WorkspaceService } from '../../workspace';
import { WorkspacePermissionStore } from '../stores/permission';
import { WorkspacePermission } from './permission';

function createPermission({
  local,
  shared,
}: {
  local: boolean;
  shared: boolean;
}) {
  const cache = new LiveData({ isOwner: true, isAdmin: false, isTeam: true });
  const store = {
    watchWorkspacePermissionCache: () => cache,
    setWorkspacePermissionCache: vi.fn((value: typeof cache.value) => {
      cache.next(value);
    }),
  };
  const framework = new Framework();
  framework
    .service(WorkspaceService, {
      workspace: {
        id: 'workspace',
        flavour: local ? 'local' : 'affine-cloud',
        openOptions: { isSharedMode: shared },
      },
    } as unknown as WorkspaceService)
    .store(
      WorkspacePermissionStore,
      store as unknown as WorkspacePermissionStore
    )
    .entity(WorkspacePermission, [WorkspaceService, WorkspacePermissionStore]);
  return {
    permission: framework.provider().createEntity(WorkspacePermission),
    cache,
  };
}

describe('WorkspacePermission public-view roles', () => {
  test.each([false, true])(
    'shared views cannot inherit cached ownership with local flavour %s',
    async local => {
      const { permission, cache } = createPermission({ local, shared: true });
      const subscription = permission.isOwnerOrAdmin$.subscribe();
      expect(permission.isOwner$.value).toBe(false);
      expect(permission.isAdmin$.value).toBe(false);
      expect(permission.isOwnerOrAdmin$.value).toBe(false);
      await permission.waitForRevalidation();
      expect(permission.isOwnerOrAdmin$.value).toBe(false);
      // The authenticated workspace's actual role remains available outside sharing.
      expect(cache.value.isOwner).toBe(true);
      subscription.unsubscribe();
      permission.dispose();
    }
  );

  test('nonshared local workspaces retain standalone ownership', async () => {
    const { permission } = createPermission({ local: true, shared: false });
    await permission.waitForRevalidation();
    expect(permission.isOwner$.value).toBe(true);
    expect(permission.isAdmin$.value).toBe(false);
    permission.dispose();
  });
});

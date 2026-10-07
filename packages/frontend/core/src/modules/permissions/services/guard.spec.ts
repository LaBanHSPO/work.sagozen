import { Framework, LiveData } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import { WorkspaceService } from '../../workspace';
import { GuardStore } from '../stores/guard';
import { GuardService } from './guard';
import { WorkspacePermissionService } from './permission';

function createGuard({
  privileged,
  allowed,
  local = false,
  shared = false,
}: {
  privileged: boolean;
  allowed: boolean;
  local?: boolean;
  shared?: boolean;
}) {
  const framework = new Framework();
  framework
    .service(WorkspaceService, {
      workspace: {
        id: 'workspace',
        flavour: local ? 'local' : 'affine-cloud',
        openOptions: { isSharedMode: shared },
      },
    } as unknown as WorkspaceService)
    .service(WorkspacePermissionService, {
      permission: {
        isOwner$: new LiveData(privileged && !shared),
        isAdmin$: new LiveData(false),
        waitForRevalidation: vi.fn(),
      },
    } as unknown as WorkspacePermissionService)
    .store(GuardStore, {
      getDocPermissions: vi.fn(async () => ({
        Doc_Trash: allowed,
        Doc_Delete: allowed,
        Doc_Restore: true,
      })),
    } as unknown as GuardStore)
    .service(GuardService, [
      GuardStore,
      WorkspaceService,
      WorkspacePermissionService,
    ]);
  return framework.provider().get(GuardService);
}

describe('destructive document capabilities', () => {
  test.each([false, true])(
    'preserves server access denials with workspace privilege %s',
    async privileged => {
      const guard = createGuard({ privileged, allowed: false });
      const trash = guard.can$('Doc_Trash', 'doc');
      const deletion = guard.can$('Doc_Delete', 'doc');
      const trashSubscription = trash.subscribe();
      const deleteSubscription = deletion.subscribe();
      guard.revalidateCan('Doc_Trash', 'doc');
      await vi.waitFor(() => expect(trash.value).toBe(false));
      expect(deletion.value).toBe(false);
      await expect(guard.can('Doc_Trash', 'doc')).resolves.toBe(false);
      await expect(guard.can('Doc_Delete', 'doc')).resolves.toBe(false);
      await expect(guard.can('Doc_Restore', 'doc')).resolves.toBe(true);
      trashSubscription.unsubscribe();
      deleteSubscription.unsubscribe();
      guard.dispose();
    }
  );

  test('active workspace privileged users retain allowed server capabilities', async () => {
    const guard = createGuard({ privileged: true, allowed: true });
    await expect(guard.can('Doc_Trash', 'doc')).resolves.toBe(true);
    await expect(guard.can('Doc_Delete', 'doc')).resolves.toBe(true);
    guard.dispose();
  });

  test('standalone local ownership is not granted to shared public views', async () => {
    const local = createGuard({
      privileged: true,
      allowed: false,
      local: true,
    });
    await expect(local.can('Doc_Delete', 'doc')).resolves.toBe(true);
    local.dispose();
    const shared = createGuard({
      privileged: true,
      allowed: true,
      local: true,
      shared: true,
    });
    await expect(shared.can('Doc_Trash', 'doc')).resolves.toBe(false);
    await expect(shared.can('Doc_Delete', 'doc')).resolves.toBe(false);
    shared.dispose();
  });
});

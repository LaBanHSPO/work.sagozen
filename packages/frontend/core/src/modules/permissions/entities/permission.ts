import {
  backoffRetry,
  effect,
  Entity,
  exhaustMapWithTrailing,
  fromPromise,
  LiveData,
  onComplete,
  onStart,
} from '@toeverything/infra';
import type { Subscription } from 'rxjs';
import { tap } from 'rxjs';

import type { WorkspaceService } from '../../workspace';
import type { WorkspacePermissionStore } from '../stores/permission';

export class WorkspacePermission extends Entity {
  private readonly cache$ = LiveData.from(
    this.store.watchWorkspacePermissionCache(),
    undefined
  );
  isOwner$ = this.cache$.map(cache =>
    this.workspaceService.workspace.openOptions.isSharedMode
      ? false
      : (cache?.isOwner ?? null)
  );
  isAdmin$ = this.cache$.map(cache =>
    this.workspaceService.workspace.openOptions.isSharedMode
      ? false
      : (cache?.isAdmin ?? null)
  );
  isOwnerOrAdmin$ = LiveData.computed(
    get => get(this.isOwner$) || get(this.isAdmin$)
  );
  isTeam$ = this.cache$.map(cache => cache?.isTeam ?? null);
  isRevalidating$ = new LiveData(false);
  private readonly subscription?: Subscription;

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly store: WorkspacePermissionStore
  ) {
    super();
    if (
      this.workspaceService.workspace.flavour !== 'local' &&
      !this.workspaceService.workspace.openOptions.isSharedMode
    ) {
      this.subscription = this.store
        .subscribeWorkspaceAccess(this.workspaceService.workspace.id)
        .subscribe({
          next: () => this.revalidate(),
          error: () => {},
        });
    }
  }

  revalidate = effect(
    exhaustMapWithTrailing(() => {
      return fromPromise(async signal => {
        if (this.workspaceService.workspace.openOptions.isSharedMode) {
          return { isOwner: false, isAdmin: false, isTeam: false };
        }
        if (
          this.workspaceService.workspace.flavour !== 'local' &&
          !this.workspaceService.workspace.openOptions.isSharedMode
        ) {
          const info = await this.store.fetchWorkspaceInfo(
            this.workspaceService.workspace.id,
            signal
          );

          const isOwner = info.workspace.permissions.Workspace_Delete;
          return {
            isOwner,
            isAdmin:
              !isOwner && info.workspace.permissions.Workspace_Settings_Update,
            isTeam: info.workspace.team,
          };
        } else {
          return { isOwner: true, isAdmin: false, isTeam: false };
        }
      }).pipe(
        backoffRetry({
          count: Infinity,
        }),
        tap(({ isOwner, isAdmin, isTeam }) => {
          // Public-view permissions must not overwrite authenticated role facts.
          if (this.workspaceService.workspace.openOptions.isSharedMode) {
            return;
          }
          this.store.setWorkspacePermissionCache({
            isOwner,
            isAdmin,
            isTeam,
          });
        }),
        onStart(() => this.isRevalidating$.setValue(true)),
        onComplete(() => this.isRevalidating$.setValue(false))
      );
    })
  );

  async waitForRevalidation(signal?: AbortSignal) {
    this.revalidate();
    await this.isRevalidating$.waitFor(
      isRevalidating => !isRevalidating,
      signal
    );
  }

  override dispose(): void {
    this.revalidate.unsubscribe();
    this.subscription?.unsubscribe();
  }
}

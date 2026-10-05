import type { DocMemberPermissionRules } from '@affine/realtime';
import { Service } from '@toeverything/infra';

import type { DocsService } from '../../doc';
import { ShareInfoService } from '../../share-doc/services/share-info';
import type { WorkspaceService } from '../../workspace';
import type { DocGrantedUsersStore } from '../stores/doc-granted-users';
import { DocGrantedUsersService } from './doc-granted-users';
import type { GuardService } from './guard';

// Access administration must not depend on loading document content or DocScope.
export class DocMemberPermissionsService extends Service {
  constructor(
    private readonly store: DocGrantedUsersStore,
    private readonly workspaceService: WorkspaceService,
    private readonly docsService: DocsService,
    private readonly guardService: GuardService
  ) {
    super();
  }

  fetchMemberPermissions(docId: string, signal?: AbortSignal) {
    return this.store.fetchMemberPermissions(
      this.workspaceService.workspace.id,
      docId,
      signal
    );
  }

  async setMemberPermissions(
    docId: string,
    expectedRevision: string,
    rules: DocMemberPermissionRules
  ) {
    const snapshot = await this.store.setMemberPermissions(
      this.workspaceService.workspace.id,
      docId,
      expectedRevision,
      rules
    );
    this.guardService.revalidateCan('Doc_Update', docId);
    const loaded = this.docsService.loaded(docId);
    if (loaded) {
      try {
        const grants = loaded.doc.scope.get(DocGrantedUsersService);
        grants.reset();
        grants.loadMore();
        loaded.doc.scope.get(ShareInfoService).shareInfo.revalidate();
      } finally {
        loaded.release();
      }
    }
    return snapshot;
  }
}

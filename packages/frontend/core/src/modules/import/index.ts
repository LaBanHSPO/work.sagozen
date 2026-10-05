import type { Framework } from '@toeverything/infra';

import { ExplorerIconService } from '../explorer-icon/services/explorer-icon';
import { OrganizeService } from '../organize';
import { TagService } from '../tag';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { ImportService } from './services/service';

export { ImportService };

export function configureImportModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(ImportService, [
      WorkspaceService,
      OrganizeService,
      ExplorerIconService,
      TagService,
    ]);
}

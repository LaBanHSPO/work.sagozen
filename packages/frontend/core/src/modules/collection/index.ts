export { Collection } from './entities/collection';
export type { CollectionMeta } from './services/collection';
export { CollectionService } from './services/collection';
export { PinnedCollectionService } from './services/pinned-collection';
export type { CollectionInfo } from './stores/collection';
export type { PinnedCollectionRecord } from './stores/pinned-collection';

import { type Framework } from '@toeverything/infra';

import { CollectionRulesService } from '../collection-rules';
import { WorkspaceDBService } from '../db';
import { WorkspacePermissionService } from '../permissions';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { Collection } from './entities/collection';
import { CollectionService } from './services/collection';
import { PinnedCollectionService } from './services/pinned-collection';
import { CollectionStore } from './stores/collection';
import { PinnedCollectionStore } from './stores/pinned-collection';

export function configureCollectionModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(CollectionService, [CollectionStore])
    .store(CollectionStore, [WorkspaceService, WorkspacePermissionService])
    .entity(Collection, [CollectionStore, CollectionRulesService])
    .store(PinnedCollectionStore, [WorkspaceDBService])
    .service(PinnedCollectionService, [PinnedCollectionStore]);
}

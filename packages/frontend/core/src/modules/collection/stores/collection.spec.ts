import { Framework, LiveData } from '@toeverything/infra';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';

import type { WorkspacePermissionService } from '../../permissions';
import type { WorkspaceService } from '../../workspace';
import { CollectionStore } from './collection';

function fixture(allowed: boolean | null) {
  const rootYDoc = new Y.Doc();
  const privilege = new LiveData(allowed);
  const workspace = { workspace: { rootYDoc } } as unknown as WorkspaceService;
  const permissions = {
    permission: { isOwnerOrAdmin$: privilege },
  } as unknown as WorkspacePermissionService;
  const framework = new Framework();
  framework.store(
    CollectionStore,
    () => new CollectionStore(workspace, permissions)
  );
  const store = framework.provider().get(CollectionStore);
  const id = store.createCollection({ name: 'Original' });
  return { store, rootYDoc, privilege, id };
}

describe('workspace collection deletion authorization', () => {
  for (const allowed of [false, null]) {
    test(`members and unresolved roles cannot delete collections: ${allowed}`, () => {
      const { store, rootYDoc, id } = fixture(allowed);
      expect(() => store.deleteCollection(id)).toThrow(
        'Only workspace owners and admins'
      );
      const collections = rootYDoc
        .getMap('setting')
        .get('collections') as Y.Array<{ id: string }>;
      expect(collections.toArray().map(collection => collection.id)).toEqual([
        id,
      ]);
    });
  }

  test('members can still create and edit collections', () => {
    const { store, rootYDoc, id } = fixture(false);
    store.updateCollectionInfo(id, { name: 'Renamed', allowList: ['doc-a'] });
    const collections = rootYDoc
      .getMap('setting')
      .get('collections') as Y.Array<unknown>;
    expect(collections.toJSON()).toEqual([
      { id, name: 'Renamed', rules: { filters: [] }, allowList: ['doc-a'] },
    ]);
  });

  test('explicit owner/admin permission permits deletion and revocation takes effect immediately', () => {
    const { store, rootYDoc, privilege, id } = fixture(true);
    store.deleteCollection(id);
    const secondId = store.createCollection({ name: 'Second' });
    privilege.setValue(false);
    expect(() => store.deleteCollection(secondId)).toThrow(
      'Only workspace owners and admins'
    );
    const collections = rootYDoc
      .getMap('setting')
      .get('collections') as Y.Array<{ id: string }>;
    expect(collections.toArray().map(collection => collection.id)).toEqual([
      secondId,
    ]);
  });
});

import { Framework, LiveData } from '@toeverything/infra';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';

import type { WorkspacePermissionService } from '../../permissions';
import type { WorkspaceService } from '../../workspace';
import { WorkspaceMetaImpl } from '../../workspace/impls/meta';
import { TagStore } from './tag';

function fixture(allowed: boolean | null) {
  const rootYDoc = new Y.Doc();
  const meta = new WorkspaceMetaImpl(rootYDoc);
  meta.initialize();
  meta.setProperties({
    tags: {
      options: [
        { id: 'tag-a', value: 'Original', color: 'red' },
        { id: 'tag-b', value: 'Second', color: 'blue' },
      ],
    },
  });
  meta.addDocMeta({ id: 'doc-a', title: '', tags: ['tag-a'], createDate: 0 });
  const privilege = new LiveData(allowed);
  const workspace = {
    workspace: {
      rootYDoc,
      docCollection: {
        doc: rootYDoc,
        meta,
        docs: new Map([
          [
            'doc-a',
            {
              id: 'doc-a',
              get meta() {
                return meta.getDocMeta('doc-a');
              },
            },
          ],
        ]),
      },
    },
  } as unknown as WorkspaceService;
  const permissions = {
    permission: { isOwnerOrAdmin$: privilege },
  } as unknown as WorkspacePermissionService;
  const framework = new Framework();
  framework.store(TagStore, () => new TagStore(workspace, permissions));
  const store = framework.provider().get(TagStore);
  return { store, meta, privilege };
}

describe('workspace tag deletion authorization', () => {
  for (const allowed of [false, null]) {
    test(`members and unresolved roles cannot remove workspace tags: ${allowed}`, () => {
      const { store, meta } = fixture(allowed);
      expect(() => store.removeTagOption('tag-a')).toThrow(
        'Only workspace owners and admins'
      );
      expect(() => store.deleteTag('tag-a')).toThrow(
        'Only workspace owners and admins'
      );
      expect(meta.properties.tags!.options.map(tag => tag.id)).toEqual([
        'tag-a',
        'tag-b',
      ]);
      expect(meta.getDocMeta('doc-a')!.tags).toEqual(['tag-a']);
    });
  }

  test('replacing options or properties cannot bypass member deletion restrictions', () => {
    const { store } = fixture(false);
    expect(() =>
      store.updateTagOptions([{ id: 'tag-b', value: 'Second', color: 'blue' }])
    ).toThrow('Only workspace owners and admins');
    expect(() => store.updateProperties({})).toThrow(
      'Only workspace owners and admins'
    );
    expect(() =>
      store.updateTagOption('tag-a', {
        id: 'replacement',
        value: 'Original',
        color: 'red',
      })
    ).toThrow('Only workspace owners and admins');
  });

  test('members retain tag creation, editing, reordering and per-document assignment removal', () => {
    const { store, meta } = fixture(false);
    store.updateTagOption('tag-a', {
      id: 'tag-a',
      value: 'Renamed',
      color: 'green',
    });
    store.updateTagOptions([...meta.properties.tags!.options].reverse());
    store.updatePageTags('doc-a', []);
    expect(meta.getDocMeta('doc-a')!.tags).toEqual([]);
    expect(meta.properties.tags!.options.map(tag => tag.id)).toEqual([
      'tag-b',
      'tag-a',
    ]);
    const created = store.createNewTag('Added', 'blue');
    expect(meta.properties.tags!.options.map(tag => tag.id)).toContain(created);
  });

  test('owners/admins delete tags and assignments; role revocation prevents subsequent deletions', () => {
    const { store, meta, privilege } = fixture(true);
    store.removeTagOption('tag-a');
    expect(meta.properties.tags!.options.map(tag => tag.id)).toEqual(['tag-b']);
    expect(meta.getDocMeta('doc-a')!.tags).toEqual([]);
    privilege.setValue(false);
    expect(() => store.removeTagOption('tag-b')).toThrow(
      'Only workspace owners and admins'
    );
  });
});

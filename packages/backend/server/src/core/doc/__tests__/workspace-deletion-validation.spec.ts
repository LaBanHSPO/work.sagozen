import test from 'ava';
import * as Y from 'yjs';

import {
  assertNoWorkspaceMetadataDeletion,
  snapshotWorkspaceDeletionState,
  WorkspaceMetadataDeleteDenied,
} from '../workspace-deletion-validation';

function fixture() {
  const doc = new Y.Doc();
  doc.getMap('setting').set(
    'collections',
    Y.Array.from([
      {
        id: 'collection-a',
        name: 'First',
        rules: { filters: [] },
        allowList: [],
      },
      {
        id: 'collection-b',
        name: 'Second',
        rules: { filters: [] },
        allowList: [],
      },
    ])
  );
  const properties = new Y.Map();
  const tags = new Y.Map();
  tags.set(
    'options',
    Y.Array.from([
      new Y.Map(Object.entries({ id: 'tag-a', value: 'First', color: 'red' })),
      new Y.Map(
        Object.entries({ id: 'tag-b', value: 'Second', color: 'blue' })
      ),
    ])
  );
  properties.set('tags', tags);
  doc.getMap('meta').set('properties', properties);
  doc.getMap('meta').set(
    'pages',
    Y.Array.from([
      new Y.Map<unknown>([
        ['id', 'doc-a'],
        ['tags', Y.Array.from(['tag-a'])],
      ]),
    ])
  );
  return doc;
}

function options(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return (doc.getMap('meta').get('properties') as Y.Map<Y.Map<unknown>>)
    .get('tags')!
    .get('options') as Y.Array<Y.Map<unknown>>;
}

const deletions: Record<string, (doc: Y.Doc) => void> = {
  'collection entry': doc => {
    (doc.getMap('setting').get('collections') as Y.Array<unknown>).delete(0);
  },
  'collections array': doc => {
    doc.getMap('setting').delete('collections');
  },
  'settings contents': doc => {
    doc.getMap('setting').clear();
  },
  'replacement collections array': doc => {
    doc
      .getMap('setting')
      .set('collections', Y.Array.from([{ id: 'collection-b' }]));
  },
  'tag entry': doc => {
    options(doc).delete(0);
  },
  'tag identifier': doc => {
    options(doc).get(0).delete('id');
  },
  'tag options array': doc => {
    (doc.getMap('meta').get('properties') as Y.Map<Y.Map<unknown>>)
      .get('tags')!
      .delete('options');
  },
  'tags parent map': doc => {
    (doc.getMap('meta').get('properties') as Y.Map<unknown>).delete('tags');
  },
  'properties parent map': doc => {
    doc.getMap('meta').delete('properties');
  },
  'metadata contents': doc => {
    doc.getMap('meta').clear();
  },
  'replacement properties': doc => {
    doc
      .getMap('meta')
      .set('properties', { tags: { options: [{ id: 'tag-b' }] } });
  },
};

for (const [name, edit] of Object.entries(deletions)) {
  test(`member cannot delete ${name}`, t => {
    const doc = fixture();
    const before = snapshotWorkspaceDeletionState(doc);
    doc.transact(() => edit(doc));
    t.throws(
      () => {
        assertNoWorkspaceMetadataDeletion(
          before,
          snapshotWorkspaceDeletionState(doc)
        );
      },
      { instanceOf: WorkspaceMetadataDeleteDenied }
    );
  });
}

test('member may remove a tag assignment from one document', t => {
  const doc = fixture();
  const before = snapshotWorkspaceDeletionState(doc);
  const pages = doc.getMap('meta').get('pages') as Y.Array<Y.Map<unknown>>;
  (pages.get(0).get('tags') as Y.Array<string>).delete(0);
  t.notThrows(() => {
    assertNoWorkspaceMetadataDeletion(
      before,
      snapshotWorkspaceDeletionState(doc)
    );
  });
});

test('members may replace, edit, reorder and add collections and workspace tags retaining all IDs', t => {
  const doc = fixture();
  const before = snapshotWorkspaceDeletionState(doc);
  doc.getMap('setting').set(
    'collections',
    Y.Array.from([
      {
        id: 'collection-b',
        name: 'Renamed',
        rules: { filters: [] },
        allowList: ['doc-a'],
      },
      { id: 'collection-a', name: 'First' },
      { id: 'collection-c', name: 'Added' },
    ])
  );
  doc.getMap('meta').set('properties', {
    tags: {
      options: [
        { id: 'tag-b', value: 'Renamed', color: 'green' },
        { id: 'tag-a', value: 'First', color: 'red' },
        { id: 'tag-c', value: 'Added', color: 'blue' },
      ],
    },
  });
  t.notThrows(() => {
    assertNoWorkspaceMetadataDeletion(
      before,
      snapshotWorkspaceDeletionState(doc)
    );
  });
});

test('snapshots hydrate Yjs roots received through updates without false deletions', t => {
  const source = fixture();
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(source));
  const before = snapshotWorkspaceDeletionState(replica);
  t.deepEqual([...before.collectionIds], ['collection-a', 'collection-b']);
  t.deepEqual([...before.tagIds], ['tag-a', 'tag-b']);
  t.notThrows(() => {
    assertNoWorkspaceMetadataDeletion(
      before,
      snapshotWorkspaceDeletionState(source)
    );
  });
});

test('missing metadata paths allow their first creation without hydrating absent roots', t => {
  const doc = new Y.Doc();
  const before = snapshotWorkspaceDeletionState(doc);
  t.is(doc.share.size, 0);
  const populated = fixture();
  t.notThrows(() => {
    assertNoWorkspaceMetadataDeletion(
      before,
      snapshotWorkspaceDeletionState(populated)
    );
  });
});

for (const malformed of [
  null,
  'invalid',
  {},
  [{ id: '' }],
  [{}],
  [{ id: 1 }],
  [{ id: 'duplicate' }, { id: 'duplicate' }],
]) {
  test(`malformed protected collection list fails closed: ${JSON.stringify(malformed)}`, t => {
    const doc = new Y.Doc();
    doc.getMap('setting').set('collections', malformed);
    t.throws(() => snapshotWorkspaceDeletionState(doc), {
      instanceOf: WorkspaceMetadataDeleteDenied,
    });
  });
  test(`malformed protected tag options fail closed: ${JSON.stringify(malformed)}`, t => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('properties', { tags: { options: malformed } });
    t.throws(() => snapshotWorkspaceDeletionState(doc), {
      instanceOf: WorkspaceMetadataDeleteDenied,
    });
  });
}

for (const path of ['properties', 'tags']) {
  test(`malformed ${path} parent fails closed`, t => {
    const doc = new Y.Doc();
    doc
      .getMap('meta')
      .set('properties', path === 'properties' ? null : { tags: null });
    t.throws(() => snapshotWorkspaceDeletionState(doc), {
      instanceOf: WorkspaceMetadataDeleteDenied,
    });
  });
}

test('malformed root received through a Yjs update fails closed', t => {
  const source = new Y.Doc();
  source.getArray('meta').push([{ properties: { tags: { options: [] } } }]);
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(source));
  t.throws(() => snapshotWorkspaceDeletionState(replica), {
    instanceOf: WorkspaceMetadataDeleteDenied,
  });
});

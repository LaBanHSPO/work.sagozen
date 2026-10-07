import test from 'ava';
import * as Y from 'yjs';

import {
  DatabaseEditDenied,
  databaseStateHash,
  validateDatabaseRecovery,
  validateDatabaseUpdates,
} from '../database-validation';

const NOW = 1_000;
const OPEN = 60_000;

function block(flavour: string, children: string[] = [], until?: unknown) {
  const value = new Y.Map<unknown>();
  value.set('sys:flavour', flavour);
  value.set('sys:children', Y.Array.from(children));
  value.set('prop:text', new Y.Text('initial'));
  if (until !== undefined) value.set('prop:memberEditUntil', until);
  return value;
}

function fixture(until?: unknown) {
  const doc = new Y.Doc({ gc: false });
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  blocks.set('page', block('affine:page', ['note']));
  blocks.set('note', block('affine:note', ['database', 'paragraph']));
  blocks.set('database', block('affine:database', ['row'], until));
  blocks.set('row', block('affine:paragraph'));
  blocks.set('paragraph', block('affine:paragraph'));
  return doc;
}

function delta(doc: Y.Doc, edit: () => void) {
  const vector = Y.encodeStateVector(doc);
  doc.transact(edit);
  return Y.encodeStateAsUpdate(doc, vector);
}

function editText(doc: Y.Doc, id: string) {
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const text = blocks.get(id)!.get('prop:text') as Y.Text;
  text.insert(text.length, ' edited');
}

test('unrelated paragraph editing remains permitted beside a closed database', t => {
  const doc = fixture();
  const snapshot = Y.encodeStateAsUpdate(doc);
  const update = delta(doc, () => editText(doc, 'paragraph'));
  t.is(
    validateDatabaseUpdates(snapshot, [], [update], NOW).expiresAt,
    undefined
  );
});

for (const operation of [
  'insert-sibling',
  'remove-sibling',
  'insert-note',
  'remove-note',
]) {
  test(`members may ${operation} without moving a closed database`, t => {
    const doc = fixture();
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    if (operation === 'remove-note') {
      blocks.set('another-note', block('affine:note', ['other']));
      blocks.set('other', block('affine:paragraph'));
      (blocks.get('page')!.get('sys:children') as Y.Array<string>).push([
        'another-note',
      ]);
    }
    const snapshot = Y.encodeStateAsUpdate(doc);
    const update = delta(doc, () => {
      const noteChildren = blocks
        .get('note')!
        .get('sys:children') as Y.Array<string>;
      const pageChildren = blocks
        .get('page')!
        .get('sys:children') as Y.Array<string>;
      if (operation === 'insert-sibling') {
        blocks.set('other', block('affine:paragraph'));
        noteChildren.insert(0, ['other']);
      } else if (operation === 'remove-sibling') {
        noteChildren.delete(1, 1);
        blocks.delete('paragraph');
      } else if (operation === 'insert-note') {
        blocks.set('another-note', block('affine:note'));
        pageChildren.insert(0, ['another-note']);
      } else {
        pageChildren.delete(1, 1);
        blocks.delete('another-note');
        blocks.delete('other');
      }
    });
    t.is(
      validateDatabaseUpdates(snapshot, [], [update], NOW).expiresAt,
      undefined
    );
  });
}

for (const until of [undefined, null, '60000', NaN, Infinity, NOW - 1, NOW]) {
  test(`database is closed with absent, invalid or expired policy: ${String(until)}`, t => {
    const doc = fixture(until);
    const snapshot = Y.encodeStateAsUpdate(doc);
    const update = delta(doc, () => editText(doc, 'row'));
    t.throws(() => validateDatabaseUpdates(snapshot, [], [update], NOW), {
      instanceOf: DatabaseEditDenied,
    });
  });
}

test('open BEFORE window admits row rich text and returns its native expiry fence', t => {
  const doc = fixture(OPEN);
  const snapshot = Y.encodeStateAsUpdate(doc);
  const update = delta(doc, () => editText(doc, 'row'));
  const proof = validateDatabaseUpdates(snapshot, [], [update], NOW);
  t.is(proof.expiresAt, OPEN);
  t.is(proof.stateHash, databaseStateHash(snapshot, []));
});

for (const until of [OPEN, OPEN + 1]) {
  test(`members cannot replace policy even with ${until === OPEN ? 'the same' : 'a later'} value`, t => {
    const doc = fixture(OPEN);
    const snapshot = Y.encodeStateAsUpdate(doc);
    const update = delta(doc, () =>
      doc
        .getMap<Y.Map<unknown>>('blocks')
        .get('database')!
        .set('prop:memberEditUntil', until)
    );
    t.throws(() => validateDatabaseUpdates(snapshot, [], [update], NOW), {
      instanceOf: DatabaseEditDenied,
    });
  });
}

test('policy writes on ordinary blocks cannot preauthorize future conversion', t => {
  const doc = fixture(OPEN);
  const snapshot = Y.encodeStateAsUpdate(doc);
  const update = delta(doc, () =>
    doc
      .getMap<Y.Map<unknown>>('blocks')
      .get('paragraph')!
      .set('prop:memberEditUntil', OPEN)
  );
  t.throws(() => validateDatabaseUpdates(snapshot, [], [update], NOW), {
    instanceOf: DatabaseEditDenied,
  });
});

test('shadowed concurrent policy writes are denied despite unchanged visible value', t => {
  const doc = fixture(OPEN);
  const snapshot = Y.encodeStateAsUpdate(doc);
  const attacker = new Y.Doc({ gc: false });
  const admin = new Y.Doc({ gc: false });
  Y.applyUpdate(attacker, snapshot);
  Y.applyUpdate(admin, snapshot);
  attacker.clientID = 1;
  admin.clientID = 2;
  const hidden = delta(attacker, () =>
    attacker
      .getMap<Y.Map<unknown>>('blocks')
      .get('database')!
      .set('prop:memberEditUntil', OPEN + 1)
  );
  const winning = delta(admin, () =>
    admin
      .getMap<Y.Map<unknown>>('blocks')
      .get('database')!
      .set('prop:memberEditUntil', OPEN)
  );
  t.throws(() => validateDatabaseUpdates(snapshot, [winning], [hidden], NOW), {
    instanceOf: DatabaseEditDenied,
  });
});

test('member cannot create a database, including create then delete in one update', t => {
  for (const erase of [false, true]) {
    const doc = fixture(OPEN);
    const snapshot = Y.encodeStateAsUpdate(doc);
    const update = delta(doc, () => {
      const blocks = doc.getMap<Y.Map<unknown>>('blocks');
      blocks.set('new', block('affine:database'));
      if (erase) blocks.delete('new');
    });
    t.throws(() => validateDatabaseUpdates(snapshot, [], [update], NOW), {
      instanceOf: DatabaseEditDenied,
    });
  }
});

test('member cannot convert a paragraph to a database', t => {
  const doc = fixture(OPEN);
  const snapshot = Y.encodeStateAsUpdate(doc);
  const update = delta(doc, () =>
    doc
      .getMap<Y.Map<unknown>>('blocks')
      .get('paragraph')!
      .set('sys:flavour', 'affine:database')
  );
  t.throws(() => validateDatabaseUpdates(snapshot, [], [update], NOW), {
    instanceOf: DatabaseEditDenied,
  });
});

test('moving an open-source row into a closed destination is denied', t => {
  const doc = fixture(OPEN);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  blocks.set('closed', block('affine:database'));
  const snapshot = Y.encodeStateAsUpdate(doc);
  const update = delta(doc, () => {
    (blocks.get('database')!.get('sys:children') as Y.Array<string>).delete(0);
    (blocks.get('closed')!.get('sys:children') as Y.Array<string>).push([
      'row',
    ]);
  });
  t.throws(() => validateDatabaseUpdates(snapshot, [], [update], NOW), {
    instanceOf: DatabaseEditDenied,
  });
});

test('multiple touched databases use the earliest BEFORE expiry', t => {
  const doc = fixture(OPEN);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  blocks.set('second', block('affine:database', ['second-row'], OPEN - 1));
  blocks.set('second-row', block('affine:paragraph'));
  const snapshot = Y.encodeStateAsUpdate(doc);
  const update = delta(doc, () => {
    editText(doc, 'row');
    editText(doc, 'second-row');
  });
  t.is(
    validateDatabaseUpdates(snapshot, [], [update], NOW).expiresAt,
    OPEN - 1
  );
});

for (const operation of ['delete', 'remove', 'reorder']) {
  test(`closed database protects ancestor ${operation}`, t => {
    const doc = fixture();
    const snapshot = Y.encodeStateAsUpdate(doc);
    const update = delta(doc, () => {
      const blocks = doc.getMap<Y.Map<unknown>>('blocks');
      if (operation === 'delete') blocks.delete('note');
      else {
        const children = blocks
          .get('note')!
          .get('sys:children') as Y.Array<string>;
        children.delete(0);
        if (operation === 'reorder') children.push(['database']);
      }
    });
    t.throws(() => validateDatabaseUpdates(snapshot, [], [update], NOW), {
      instanceOf: DatabaseEditDenied,
    });
  });
}

test('pending structs cannot conceal delayed database edits', t => {
  const doc = fixture(OPEN);
  const snapshot = Y.encodeStateAsUpdate(doc);
  delta(doc, () => editText(doc, 'row'));
  const unresolved = delta(doc, () => editText(doc, 'row'));
  t.throws(() => validateDatabaseUpdates(snapshot, [], [unresolved], NOW), {
    instanceOf: DatabaseEditDenied,
  });
});

test('pending delete sets cannot conceal future deletions', t => {
  const doc = fixture(OPEN);
  const snapshot = Y.encodeStateAsUpdate(doc);
  delta(doc, () => editText(doc, 'row'));
  const deletion = delta(doc, () => {
    const text = doc
      .getMap<Y.Map<unknown>>('blocks')
      .get('row')!
      .get('prop:text') as Y.Text;
    text.delete('initial'.length, ' edited'.length);
  });
  t.throws(() => validateDatabaseUpdates(snapshot, [], [deletion], NOW), {
    instanceOf: DatabaseEditDenied,
  });
});

test('already admitted policy and content replay needs no open window', t => {
  const doc = fixture(OPEN);
  const snapshot = Y.encodeStateAsUpdate(doc);
  const update = delta(doc, () => editText(doc, 'row'));
  t.is(
    validateDatabaseUpdates(snapshot, [update], [snapshot, update], OPEN + 1)
      .expiresAt,
    undefined
  );
});

test('malformed or forbidden mixed batches do not mutate canonical bytes', t => {
  const doc = fixture();
  const snapshot = Y.encodeStateAsUpdate(doc);
  const original = Buffer.from(snapshot);
  const valid = delta(doc, () => editText(doc, 'paragraph'));
  const forbidden = delta(doc, () => editText(doc, 'row'));
  for (const invalid of [forbidden, Uint8Array.of(255)]) {
    t.throws(
      () => validateDatabaseUpdates(snapshot, [], [valid, invalid], NOW),
      { instanceOf: DatabaseEditDenied }
    );
    t.deepEqual(Buffer.from(snapshot), original);
  }
});

test('all persisted updates contribute to the state and fingerprint beyond 100 rows', t => {
  const doc = fixture(OPEN);
  const snapshot = Y.encodeStateAsUpdate(doc);
  const persisted = Array.from({ length: 105 }, () =>
    delta(doc, () => editText(doc, 'paragraph'))
  );
  const update = delta(doc, () => editText(doc, 'row'));
  t.is(
    validateDatabaseUpdates(snapshot, persisted, [update], NOW).expiresAt,
    OPEN
  );
  t.not(
    databaseStateHash(snapshot, persisted),
    databaseStateHash(snapshot, persisted.slice(0, 100))
  );
});

test('member recovery refuses a database in either current or historical state', t => {
  const database = Y.encodeStateAsUpdate(fixture(OPEN));
  const plain = new Y.Doc();
  plain.getMap('blocks').set('paragraph', block('affine:paragraph'));
  const ordinary = Y.encodeStateAsUpdate(plain);
  t.throws(() => validateDatabaseRecovery(database, [], ordinary), {
    instanceOf: DatabaseEditDenied,
  });
  t.throws(() => validateDatabaseRecovery(ordinary, [], database), {
    instanceOf: DatabaseEditDenied,
  });
});

test('a forbidden collection deletion rejects a mixed atomic update batch', t => {
  const doc = fixture();
  doc
    .getMap('setting')
    .set('collections', Y.Array.from([{ id: 'kept', name: 'Samples' }]));
  const snapshot = Y.encodeStateAsUpdate(doc);
  const ordinary = delta(doc, () => editText(doc, 'paragraph'));
  const removal = delta(doc, () =>
    (doc.getMap('setting').get('collections') as Y.Array<unknown>).delete(0, 1)
  );
  t.throws(
    () => validateDatabaseUpdates(snapshot, [], [ordinary, removal], NOW),
    { instanceOf: DatabaseEditDenied }
  );
});

test('member history recovery cannot delete tags through a database-free root snapshot', t => {
  const current = new Y.Doc();
  current.getMap('meta').set('properties', {
    tags: { options: [{ id: 'kept', value: 'Samples' }] },
  });
  const historical = new Y.Doc();
  t.throws(
    () =>
      validateDatabaseRecovery(
        Y.encodeStateAsUpdate(current),
        [],
        Y.encodeStateAsUpdate(historical)
      ),
    { instanceOf: DatabaseEditDenied }
  );
});

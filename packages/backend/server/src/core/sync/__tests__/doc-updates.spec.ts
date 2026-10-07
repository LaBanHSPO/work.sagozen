import test from 'ava';
import Sinon from 'sinon';

import { DocNotFound } from '../../../base';
import { BackendRuntimeError } from '../../backend-runtime';
import { PgWorkspaceDocStorageAdapter } from '../../doc';
import { SpaceSyncGateway } from '../gateway';

function createSync() {
  const append = Sinon.stub().resolves(1234);
  const created = Sinon.stub().resolves();
  const broadcast = Sinon.stub();
  const runtime = { appendWorkspaceDocUpdatesV1: append };
  const models = {
    doc: {
      exists: Sinon.stub().resolves(false),
      getMeta: Sinon.stub().resolves(null),
    },
  };
  const event = { emitDetachedAsync: created, broadcast };
  const storage = new PgWorkspaceDocStorageAdapter(
    models as never,
    {} as never,
    event as never,
    {} as never,
    runtime as never
  );
  Object.defineProperty(storage, 'preflightDatabaseUpdates', {
    value: async () => ({ stateHash: 'authorized-canonical-state' }),
  });
  const gateway = new SpaceSyncGateway(
    {} as never,
    storage,
    {} as never,
    {} as never,
    models as never,
    event as never,
    runtime as never
  );
  const emit = Sinon.stub();
  const client = {
    id: 'sender',
    rooms: new Set(['workspace:workspace:sync']),
    to: Sinon.stub().returns({ emit }),
  };
  // @ts-expect-error install the transport normally supplied by Nest
  gateway.server = {};

  const message = {
    spaceType: 'workspace' as never,
    spaceId: 'workspace',
    docId: 'missing-doc',
    update: Buffer.from([0, 0]).toString('base64'),
  };
  function subscribe(docId: string, canUpdate = true) {
    // @ts-expect-error install an authorized subscription without starting a server
    gateway.addActiveDocSubscription(
      client as never,
      message.spaceType,
      message.spaceId,
      docId,
      new Set(canUpdate ? ['Doc.Read', 'Doc.Update'] : ['Doc.Read']),
      1
    );
  }
  function push(docId = message.docId) {
    return gateway.onReceiveDocUpdate(
      client as never,
      { id: 'user' } as never,
      {
        ...message,
        docId,
      }
    );
  }
  return { append, created, broadcast, emit, storage, subscribe, push };
}

test('missing workspace documents are acknowledged without retry or broadcast, and sync continues', async t => {
  const sync = createSync();
  sync.subscribe('missing-doc');
  sync.subscribe('new-doc');
  sync.append
    .onFirstCall()
    .rejects(new BackendRuntimeError('doc_not_found', 'doc_not_found'));

  const before = Date.now();
  const response = await sync.push();
  t.true(response.data.accepted);
  t.true(response.data.timestamp! >= before);
  t.true(response.data.timestamp! <= Date.now());
  t.is(sync.append.callCount, 1);
  t.false(sync.created.called);
  t.false(sync.emit.called);
  t.false(sync.broadcast.called);

  t.deepEqual(await sync.push('new-doc'), {
    data: { accepted: true, timestamp: 1234 },
  });
  t.is(sync.append.callCount, 2);
  t.true(sync.created.calledOnce);
  t.true(sync.emit.calledOnce);
  t.true(sync.broadcast.calledOnce);
  t.is(sync.broadcast.firstCall.args[1].docId, 'new-doc');
});

test('storage preserves missing document errors without retry or publication', async t => {
  const sync = createSync();
  sync.append
    .onFirstCall()
    .rejects(new BackendRuntimeError('doc_not_found', 'doc_not_found'));

  await t.throwsAsync(
    () =>
      sync.storage.pushDocUpdates(
        'workspace',
        'missing-doc',
        Array.from({ length: 21 }, () => Buffer.from([0, 0])),
        'user'
      ),
    { instanceOf: DocNotFound }
  );
  t.is(sync.append.callCount, 1);
  t.false(sync.created.called);
});

test('transient save failures still retry and publish after success', async t => {
  const sync = createSync();
  sync.subscribe('new-doc');
  sync.append.onFirstCall().rejects(new Error('temporary save failure'));

  t.deepEqual(await sync.push('new-doc'), {
    data: { accepted: true, timestamp: 1234 },
  });
  t.is(sync.append.callCount, 2);
  t.true(sync.created.calledOnce);
  t.true(sync.emit.calledOnce);
  t.true(sync.broadcast.calledOnce);
});

for (const error of [
  new BackendRuntimeError('domain_permission_denied', 'permission denied'),
  new Error('doc_not_found'),
]) {
  test(`save failures remain errors: ${error.name}: ${error.message}`, async t => {
    const sync = createSync();
    sync.subscribe('missing-doc');
    sync.append.rejects(error);
    t.like(await sync.push(), { error: { name: 'FAILED_TO_SAVE_UPDATES' } });
    t.is(sync.append.callCount, 4);
    t.false(sync.created.called);
    t.false(sync.emit.called);
    t.false(sync.broadcast.called);
  });
}

for (const canUpdate of [false, true]) {
  test(`missing document sync still requires ${canUpdate ? 'a subscription' : 'update permission'}`, async t => {
    const sync = createSync();
    sync.append.rejects(
      new BackendRuntimeError('doc_not_found', 'doc_not_found')
    );
    if (!canUpdate) sync.subscribe('missing-doc', false);

    const response = await sync.push();
    t.like(response, {
      error: { name: canUpdate ? 'NOT_IN_SPACE' : 'DOC_ACTION_DENIED' },
    });
    t.false(sync.append.called);
    t.false(sync.emit.called);
    t.false(sync.broadcast.called);
  });
}

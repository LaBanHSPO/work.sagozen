import test from 'ava';

import { DocActionDenied } from '../../../base';
import { BackendRuntimeError } from '../../backend-runtime';
import { PgWorkspaceDocStorageAdapter } from '../adapters/workspace';
import {
  DatabaseEditDenied,
  type DatabaseValidation,
} from '../database-validation';

function adapter(
  append: (input: {
    updates: Buffer[];
    databaseValidation?: DatabaseValidation;
  }) => Promise<number>,
  preflight: () => Promise<DatabaseValidation | undefined>
) {
  const storage = new PgWorkspaceDocStorageAdapter(
    { doc: { exists: async () => true } } as never,
    {} as never,
    {} as never,
    {} as never,
    { appendWorkspaceDocUpdatesV1: append } as never
  );
  Object.defineProperty(storage, 'filterValidDocUpdates', {
    value: async (_workspace: string, _doc: string, updates: Uint8Array[]) =>
      updates,
    configurable: true,
  });
  Object.defineProperty(storage, 'preflightDatabaseUpdates', {
    value: preflight,
  });
  return storage;
}

test('database denial is surfaced without retrying or appending any subset', async t => {
  let calls = 0;
  let validations = 0;
  const storage = adapter(
    async () => {
      calls++;
      return 123;
    },
    async () => {
      validations++;
      throw new DatabaseEditDenied();
    }
  );
  await t.throwsAsync(
    storage.pushDocUpdates('workspace', 'doc', [Uint8Array.of(0, 0)], 'member'),
    { instanceOf: DocActionDenied }
  );
  t.is(validations, 1);
  t.is(calls, 0);
});

test('native expiry or privilege-downgrade denial is permanent and user friendly', async t => {
  let calls = 0;
  const storage = adapter(
    async () => {
      calls++;
      throw new BackendRuntimeError('database_edit_denied', 'closed');
    },
    async () => ({ stateHash: 'proof', expiresAt: 10 })
  );
  await t.throwsAsync(
    storage.pushDocUpdates('workspace', 'doc', [Uint8Array.of(0, 0)], 'member'),
    { instanceOf: DocActionDenied }
  );
  t.is(calls, 1);
});

test('stale state regenerates validation rather than reusing a prior proof', async t => {
  let validations = 0;
  const hashes: (string | undefined)[] = [];
  const storage = adapter(
    async input => {
      hashes.push(input.databaseValidation?.stateHash);
      if (hashes.length === 1)
        throw new BackendRuntimeError('database_validation_stale', 'changed');
      return 123;
    },
    async () => ({ stateHash: String(++validations) })
  );
  t.is(
    await storage.pushDocUpdates(
      'workspace',
      'doc',
      [Uint8Array.of(0, 0)],
      'member'
    ),
    123
  );
  t.deepEqual(hashes, ['1', '2']);
});

test('malformed mixed requests do not persist the valid subset', async t => {
  let calls = 0;
  const storage = adapter(
    async () => {
      calls++;
      return 123;
    },
    async () => ({ stateHash: 'proof' })
  );
  Object.defineProperty(storage, 'filterValidDocUpdates', {
    value: async () => [Uint8Array.of(0, 0)],
    configurable: true,
  });
  await t.throwsAsync(
    storage.pushDocUpdates(
      'workspace',
      'doc',
      [Uint8Array.of(0, 0), Uint8Array.of(255)],
      'member'
    ),
    { instanceOf: DocActionDenied }
  );
  t.is(calls, 0);
});

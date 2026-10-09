import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import native from '../native/index.js';
import { DatabaseEditDenied, validateDatabaseUpdates } from './src/core/doc/database-validation.ts';

const prisma = new PrismaClient();
const suffix = randomUUID();
const workspaceId = `db-smoke-${suffix}`;
const docId = `doc-${suffix}`;
const owner = `owner-${suffix}`;
const admin = `admin-${suffix}`;
const member = `member-${suffix}`;
const runtime = new native.BackendRuntime(new native.ServerConfigHandle('/tmp/affine-database-smoke-config.json'), 'smoke-only-private-key');
const executed = [];
const sql = (text, ...args) => prisma.$executeRawUnsafe(text, ...args);
function block(flavour, children = []) {
  const value = new Y.Map();
  value.set('sys:flavour', flavour);
  value.set('sys:children', Y.Array.from(children));
  value.set('prop:text', new Y.Text('initial'));
  return value;
}
async function source(id = docId) {
  const rows = await prisma.$queryRawUnsafe('SELECT blob FROM snapshots WHERE workspace_id=$1 AND guid=$2', workspaceId, id);
  const updates = await prisma.$queryRawUnsafe('SELECT blob FROM updates WHERE workspace_id=$1 AND guid=$2 ORDER BY created_at', workspaceId, id);
  return { snapshot: rows[0] ? Buffer.from(rows[0].blob) : null, updates: updates.map(row => Buffer.from(row.blob)) };
}
async function candidate(edit, id = docId) {
  const state = await source(id);
  const doc = new Y.Doc({ gc: false });
  if (state.snapshot) Y.applyUpdate(doc, state.snapshot);
  for (const update of state.updates) Y.applyUpdate(doc, update);
  const vector = Y.encodeStateVector(doc);
  doc.transact(() => edit(doc));
  const update = Buffer.from(Y.encodeStateAsUpdate(doc, vector));
  doc.destroy();
  return { state, update };
}
function append(actorUserId, update, databaseValidation, id = docId) {
  return runtime.appendWorkspaceDocUpdatesV1({ workspaceId, docId: id, updates: [update], actorUserId, writeIntent: 'update_doc', databaseValidation });
}
function proof(value) {
  return validateDatabaseUpdates(value.state.snapshot, value.state.updates, [value.update], Date.now());
}
const editText = id => doc => {
  const text = doc.getMap('blocks').get(id).get('prop:text');
  text.insert(text.length, ' edited');
};
try {
  await runtime.start();
  await sql('INSERT INTO workspaces(id) VALUES($1)', workspaceId);
  await sql('INSERT INTO workspace_access_policies(workspace_id) VALUES($1)', workspaceId);
  for (const [userId, role] of [[owner, 'owner'], [admin, 'admin'], [member, 'member']]) {
    await sql("INSERT INTO users(id,name,email,registered,email_verified,disabled) VALUES($1,'Permission Smoke',$2,true,now(),false)", userId, `${userId}@example.invalid`);
    await sql("INSERT INTO workspace_members(workspace_id,user_id,role,state) VALUES($1,$2,$3,'active')", workspaceId, userId, role);
    await sql("INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role) VALUES($1,$2,'user',$3,'owner')", workspaceId, docId, userId);
    await sql("INSERT INTO doc_grants(workspace_id,doc_id,principal_type,principal_id,role) VALUES($1,$1,'user',$2,'owner')", workspaceId, userId);
  }
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  blocks.set('page', block('affine:page', ['note']));
  blocks.set('note', block('affine:note', ['database', 'paragraph']));
  blocks.set('database', block('affine:database', ['row']));
  blocks.set('row', block('affine:paragraph'));
  blocks.set('paragraph', block('affine:paragraph'));
  await runtime.upsertDocSnapshot(workspaceId, docId, Buffer.from(Y.encodeStateAsUpdate(doc)), Date.now(), owner);
  doc.destroy();
  const root = new Y.Doc();
  const pageMeta = new Y.Map();
  pageMeta.set('id', docId);
  pageMeta.set('title', 'Permission Smoke');
  root.getMap('meta').set('pages', Y.Array.from([pageMeta]));
  root.getMap('setting').set('collections', Y.Array.from([{ id: 'collection', name: 'Samples' }]));
  const properties = new Y.Map();
  const tags = new Y.Map();
  tags.set('options', Y.Array.from([{ id: 'tag', value: 'Samples', color: 'red' }]));
  properties.set('tags', tags);
  root.getMap('meta').set('properties', properties);
  await runtime.upsertDocSnapshot(workspaceId, workspaceId, Buffer.from(Y.encodeStateAsUpdate(root)), Date.now(), owner);
  root.destroy();
  const rootMetadata = await candidate(doc => doc.getMap('setting').set('safe-setting', 'member may edit'), workspaceId);
  const rootInput = {
    command: 'append_root_update',
    actorUserId: member,
    workspaceId,
    update: rootMetadata.update.toString('base64'),
    assertPermission: true,
  };
  await assert.rejects(runtime.executeDomainCommandV1(rootInput), /database_edit_denied/);
  await runtime.executeDomainCommandV1({ ...rootInput, databaseValidation: proof(rootMetadata) });
  executed.push('workspace-root command rejects missing validation but admits member metadata edits with canonical proof');

  const closed = await candidate(editText('row'));
  assert.throws(() => proof(closed), DatabaseEditDenied);
  await assert.rejects(append(member, closed.update), /database_edit_denied/);
  executed.push('closed database rejects member, including forged direct native append');

  const unrelated = await candidate(editText('paragraph'));
  await append(member, unrelated.update, proof(unrelated));
  executed.push('member edits unrelated document content normally');

  const open = await candidate(doc => doc.getMap('blocks').get('database').set('prop:memberEditUntil', Date.now() + 1500));
  await append(owner, open.update);
  const allowed = await candidate(editText('row'));
  const allowedProof = proof(allowed);
  assert.ok(allowedProof.expiresAt > Date.now());
  await append(member, allowed.update, allowedProof);
  executed.push('member edit is persisted within actual timed window');

  const late = await candidate(editText('row'));
  const lateProof = proof(late);
  const countBeforeExpiry = (await source()).updates.length;
  await delay(Math.max(0, lateProof.expiresAt - Date.now()) + 30);
  assert.throws(() => proof(late), DatabaseEditDenied);
  await assert.rejects(append(member, late.update, lateProof), /database_edit_denied/);
  assert.equal((await source()).updates.length, countBeforeExpiry);
  executed.push('actual wall-clock expiry denies native commit without changing persisted state');

  const reopen = await candidate(doc => doc.getMap('blocks').get('database').set('prop:memberEditUntil', Date.now() + 60_000));
  await append(owner, reopen.update);
  const stale = await candidate(editText('row'));
  const staleProof = proof(stale);
  const revoke = await candidate(doc => doc.getMap('blocks').get('database').set('prop:memberEditUntil', 0));
  await append(owner, revoke.update);
  await assert.rejects(append(member, stale.update, staleProof), /database_validation_stale/);
  const freshState = await source();
  assert.throws(() => validateDatabaseUpdates(freshState.snapshot, freshState.updates, [stale.update], Date.now()), DatabaseEditDenied);
  const adminEdit = await candidate(editText('row'));
  await append(admin, adminEdit.update);
  executed.push('revocation fences stale admission; active admin can still edit closed database');

  for (const [name, edit] of [
    ['collection', doc => doc.getMap('setting').get('collections').delete(0, 1)],
    ['tag', doc => doc.getMap('meta').get('properties').get('tags').get('options').delete(0, 1)],
  ]) {
    const removal = await candidate(edit, workspaceId);
    assert.throws(() => proof(removal), DatabaseEditDenied);
    await assert.rejects(append(member, removal.update, undefined, workspaceId), /database_edit_denied/);
    await append(owner, removal.update, undefined, workspaceId);
    executed.push(`member cannot delete ${name}; owner deletion persists`);
  }

  const permissions = await runtime.authorizePermissionV1({ version: 1, workspaceId, actorUserId: member, workspaceActions: [], docs: [{ docId, actions: ['Doc.Trash', 'Doc.Delete', 'Doc.Restore'] }] });
  console.log('MEMBER_DOCUMENT_PERMISSIONS', JSON.stringify(permissions));
  for (const lifecycle of ['trash', 'delete']) {
    await assert.rejects(runtime.executeDomainCommandV1({ command: 'apply_doc_lifecycle', actorUserId: member, workspaceId, docId, lifecycle }), /domain_permission_denied/);
  }
  await runtime.executeDomainCommandV1({ command: 'apply_doc_lifecycle', actorUserId: owner, workspaceId, docId, lifecycle: 'trash' });
  await runtime.executeDomainCommandV1({ command: 'apply_doc_lifecycle', actorUserId: admin, workspaceId, docId, lifecycle: 'restore' });
  await runtime.executeDomainCommandV1({ command: 'apply_doc_lifecycle', actorUserId: admin, workspaceId, docId, lifecycle: 'delete' });
  assert.equal((await source()).snapshot, null);
  assert.equal((await source()).updates.length, 0);
  executed.push('document owner/member cannot trash/delete; workspace owner/admin can trash, restore, permanently delete');
  console.log(JSON.stringify({ runtime: 'native PostgreSQL transaction and Yjs admission', executed }, null, 2));
} finally {
  await runtime.stop();
  await prisma.$disconnect();
}

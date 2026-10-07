import { DatabaseBlockDataSource } from '@blocksuite/affine-block-database';
import {
  type DatabaseBlockModel,
  DatabaseBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/affine-model';
import { TestWorkspace } from '@blocksuite/store/test';
import { signal } from '@preact/signals-core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';

function setup(canManage = false) {
  const workspace = new TestWorkspace();
  workspace.meta.initialize();
  const doc = workspace.createDoc('database-permissions');
  doc.load();
  const store = doc.getStore({
    extensions: [
      RootBlockSchemaExtension,
      NoteBlockSchemaExtension,
      ParagraphBlockSchemaExtension,
      DatabaseBlockSchemaExtension,
    ],
  });
  const root = store.addBlock('affine:page', {});
  const note = store.addBlock('affine:note', {}, root);
  const id = store.addBlock('affine:database', {}, note);
  const model = store.getModelById(id) as DatabaseBlockModel;
  const manage$ = signal(canManage);
  const source = new DatabaseBlockDataSource(
    model,
    undefined,
    signal('member'),
    manage$
  );
  return { store, model, source, manage$ };
}

afterEach(() => vi.useRealTimers());

describe('Database editing permissions', () => {
  test('loading a legacy database as a member stays read-only without generating a sync update', () => {
    const { store, model } = setup();
    const vector = Y.encodeStateVector(store.spaceDoc);
    const reopened = store.doc.getStore({
      id: 'legacy-member-reader',
      extensions: [
        RootBlockSchemaExtension,
        NoteBlockSchemaExtension,
        ParagraphBlockSchemaExtension,
        DatabaseBlockSchemaExtension,
      ],
    });
    const reopenedModel = reopened.getModelById(model.id) as DatabaseBlockModel;
    const source = new DatabaseBlockDataSource(
      reopenedModel,
      undefined,
      signal('member'),
      signal(false)
    );
    expect(source.readonly$.value).toBe(true);
    expect(reopenedModel.props.memberEditUntil).toBeUndefined();
    expect(Y.encodeStateVector(store.spaceDoc)).toEqual(vector);
  });
  test('members cannot append rows or change columns outside an editing window', () => {
    const { source, model } = setup();
    expect(source.readonly$.value).toBe(true);
    expect(() => source.rowAdd('end')).toThrow('read-only');
    expect(() => source.propertyAdd('end', { type: 'rich-text' })).toThrow(
      'read-only'
    );
    expect(model.children).toEqual([]);
    expect(model.props.columns).toEqual([]);
  });

  test('an open window permits edits, then expires at its exact boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { source, model } = setup();
    model.props.memberEditUntil = 160_000;
    const row = source.rowAdd('end');
    expect(model.children.map(child => child.id)).toEqual([row]);
    vi.setSystemTime(160_000);
    source.permissionTime$.value = Date.now();
    expect(source.readonly$.value).toBe(true);
    expect(() => source.rowDelete([row])).toThrow('read-only');
    expect(model.children.map(child => child.id)).toEqual([row]);
  });

  test('mutation checks expiry even before the UI clock catches up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { source, model } = setup();
    model.props.memberEditUntil = 160_000;
    expect(source.readonly$.value).toBe(false);
    vi.setSystemTime(160_001);
    expect(() => source.rowAdd('end')).toThrow('read-only');
    expect(model.children).toEqual([]);
  });

  test('revocation and workspace role changes immediately alter edit access', () => {
    const { source, model, manage$ } = setup();
    model.props.memberEditUntil = Date.now() + 60_000;
    expect(source.readonly$.value).toBe(false);
    model.props.memberEditUntil = 0;
    expect(source.readonly$.value).toBe(true);
    manage$.value = true;
    expect(source.readonly$.value).toBe(false);
    source.rowAdd('end');
    manage$.value = false;
    expect(() => source.rowAdd('end')).toThrow('read-only');
  });

  test('an editing window never overrides document read-only access', () => {
    const { store, source, model } = setup();
    model.props.memberEditUntil = Date.now() + 60_000;
    store.readonly = true;
    expect(source.readonly$.value).toBe(true);
    expect(() => source.rowAdd('end')).toThrow('read-only');
  });
});

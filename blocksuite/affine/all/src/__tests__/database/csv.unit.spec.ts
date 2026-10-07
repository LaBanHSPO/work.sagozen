import { DatabaseBlockDataSource } from '@blocksuite/affine-block-database';
import {
  type DatabaseBlockModel,
  DatabaseBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/affine-model';
import {
  createAutoIncrementIdGenerator,
  TestWorkspace,
} from '@blocksuite/store/test';
import { signal } from '@preact/signals-core';
import { describe, expect, test } from 'vitest';

import {
  exportDatabaseCsv,
  importDatabaseCsv,
  parseCsv,
  stringifyCsv,
} from '../../../../blocks/database/src/utils/csv.js';

function createDatabase() {
  const workspace = new TestWorkspace({
    id: 'csv-tests',
    idGenerator: createAutoIncrementIdGenerator(),
  });
  workspace.meta.initialize();
  const document = workspace.createDoc('csv');
  document.load();
  const store = document.getStore({
    extensions: [
      RootBlockSchemaExtension,
      NoteBlockSchemaExtension,
      ParagraphBlockSchemaExtension,
      DatabaseBlockSchemaExtension,
    ],
  });
  const rootId = store.addBlock('affine:page');
  const noteId = store.addBlock('affine:note', {}, rootId);
  const id = store.addBlock('affine:database', { columns: [] }, noteId);
  const model = store.getModelById(id) as DatabaseBlockModel;
  return { source: new DatabaseBlockDataSource(model), model };
}

function property(source: DatabaseBlockDataSource, name: string, type: string) {
  const id = source.propertyAdd('end', { name, type });
  if (!id) throw new Error(`Could not create ${name}.`);
  return id;
}

describe('database CSV syntax', () => {
  test('preserves BOM, CRLF, Unicode, multiline cells, escaped quotes and empty cells', () => {
    const rows = [
      ['Title', 'Notes', 'Empty'],
      ['日本語, café', 'line 1\r\nline 2 "quoted"', ''],
      ['', '', ''],
    ];
    const csv = '\uFEFF' + stringifyCsv(rows) + '\r\n';
    expect(parseCsv(csv)).toEqual(rows);
  });

  test('preserves a quoted empty final record and a final empty cell', () => {
    expect(parseCsv('Title\r\n""')).toEqual([['Title'], ['']]);
    expect(parseCsv('Title,Notes\na,')).toEqual([
      ['Title', 'Notes'],
      ['a', ''],
    ]);
  });

  test.each([
    'Title,Notes\na',
    'Title,Notes\na,b,c',
    'Title\n"unterminated',
    'Title\n"closed"garbage',
    'Title\nbare"quote',
    '',
  ])('rejects malformed CSV: %s', csv => {
    expect(() => parseCsv(csv)).toThrow();
  });
});

describe('database CSV conversion', () => {
  test('appends rows, matches headers by name, and creates missing text columns', () => {
    const { source } = createDatabase();
    const number = property(source, 'Amount', 'number');
    const existing = source.rowAdd('end');
    source.cellValueChange(existing, 'title', 'Keep me');
    expect(
      importDatabaseCsv(
        source,
        'Amount,Title,Notes\r\n12.5,New,"hello, world"\r\n'
      )
    ).toBe(1);
    expect(source.rows$.value[0]).toBe(existing);
    expect(source.cellValueGet(existing, 'title')?.toString()).toBe('Keep me');
    const added = source.rows$.value[1];
    expect(added).toBeDefined();
    expect(source.cellValueGet(added!, 'title')?.toString()).toBe('New');
    expect(source.cellValueGet(added!, number)).toBe(12.5);
    const notes = source.properties$.value.find(
      id => source.propertyNameGet(id) === 'Notes'
    );
    expect(notes).toBeDefined();
    expect(source.cellValueGet(added!, notes!)?.toString()).toBe(
      'hello, world'
    );
  });

  test('uses the first CSV column as title when no title header matches', () => {
    const { source } = createDatabase();
    importDatabaseCsv(source, 'Name,Notes\nFirst,Details');
    expect(
      source.cellValueGet(source.rows$.value[0]!, 'title')?.toString()
    ).toBe('First');
    expect(
      source.properties$.value.some(id => source.propertyNameGet(id) === 'Name')
    ).toBe(false);
  });

  test('preflights the entire file and does not mutate rows, columns or select options on failure', () => {
    const { source } = createDatabase();
    const select = property(source, 'Status', 'select');
    property(source, 'Amount', 'number');
    const before = JSON.parse(JSON.stringify(source.propertyDataGet(select)));
    const columns = [...source.properties$.value];
    expect(() =>
      importDatabaseCsv(
        source,
        'Title,Status,Amount,New column\nOne,New option,1,Good\nTwo,Another option,not-a-number,Bad'
      )
    ).toThrow(/record 3.*Amount/);
    expect(source.rows$.value).toEqual([]);
    expect(source.properties$.value).toEqual(columns);
    expect(source.propertyDataGet(select)).toEqual(before);
    expect(() =>
      importDatabaseCsv(source, 'Title,New column\nOne,Good\nTwo')
    ).toThrow();
    expect(source.rows$.value).toEqual([]);
    expect(source.properties$.value).toEqual(columns);
  });

  test('header-only import is a no-op and ambiguous headers are rejected', () => {
    const { source } = createDatabase();
    expect(importDatabaseCsv(source, 'Title,New column\r\n')).toBe(0);
    expect(source.properties$.value).toEqual(['title']);
    expect(() => importDatabaseCsv(source, 'Title,Title\nOne,Two')).toThrow(
      /unique/
    );
    expect(() => importDatabaseCsv(source, 'Title,\nOne,Two')).toThrow(/empty/);
  });

  test('rejects ambiguous database column names instead of targeting an arbitrary column', () => {
    const { source } = createDatabase();
    property(source, 'Notes', 'rich-text');
    const other = property(source, 'Other', 'rich-text');
    source.propertyNameSet(other, 'Notes');
    expect(() => importDatabaseCsv(source, 'Title,Notes\nRow,Text')).toThrow(
      /ambiguous/
    );
    expect(() => exportDatabaseCsv(source)).toThrow(/unique/);
    expect(source.rows$.value).toEqual([]);
  });

  test('roundtrips all rows and supported property values with ordered headers', () => {
    const { source } = createDatabase();
    const amount = property(source, 'Amount', 'number');
    const checked = property(source, 'Checked', 'checkbox');
    const date = property(source, 'Date', 'date');
    const select = property(source, 'Status', 'select');
    const tags = property(source, 'Tags', 'multi-select');
    const progress = property(source, 'Progress', 'progress');
    importDatabaseCsv(
      source,
      'Title,Amount,Checked,Date,Status,Tags,Progress\r\n"One, 日本語",2.5,True,2026-10-05,Done,"A,B",75\r\nTwo,,False,,,,0\r\n'
    );
    const exported = exportDatabaseCsv(source);
    expect(parseCsv(exported)).toEqual([
      ['Title', 'Amount', 'Checked', 'Date', 'Status', 'Tags', 'Progress'],
      [
        'One, 日本語',
        '2.5',
        'True',
        '2026-10-05',
        '["Done"]',
        '["A","B"]',
        '75',
      ],
      ['Two', '', 'False', '', '[]', '[]', '0'],
    ]);
    expect(importDatabaseCsv(source, exported)).toBe(2);
    expect(source.rows$.value).toHaveLength(4);
    for (const id of ['title', amount, checked, date, select, tags, progress]) {
      for (let index = 0; index < 2; index++) {
        const first = source.cellValueGet(source.rows$.value[index]!, id);
        const second = source.cellValueGet(source.rows$.value[index + 2]!, id);
        if (id === 'title') expect(second?.toString()).toBe(first?.toString());
        else expect(second).toEqual(first);
      }
    }
  });

  test('omits generated columns and roundtrips JSON-encoded select labels without losing commas or whitespace', () => {
    const { source, model } = createDatabase();
    property(source, 'Created', 'created-time');
    const select = property(source, 'Status', 'select');
    const tags = property(source, 'Tags', 'multi-select');
    model.props.columns = [
      ...model.props.columns,
      { id: 'type', type: 'image', name: 'Block Type', data: {} },
    ];
    const labels = ['A,B', '  spaced  ', 'Line\n"quoted"', ''];
    importDatabaseCsv(
      source,
      stringifyCsv([
        ['Title', 'Status', 'Tags'],
        ['Row', JSON.stringify(['A,B']), JSON.stringify(labels)],
      ])
    );
    const csv = exportDatabaseCsv(source);
    expect(parseCsv(csv)).toEqual([
      ['Title', 'Status', 'Tags'],
      ['Row', '["A,B"]', JSON.stringify(labels)],
    ]);
    expect(importDatabaseCsv(source, csv)).toBe(1);
    const [first, second] = source.rows$.value;
    expect(source.cellValueGet(second!, select)).toEqual(
      source.cellValueGet(first!, select)
    );
    expect(source.cellValueGet(second!, tags)).toEqual(
      source.cellValueGet(first!, tags)
    );
  });

  test('roundtrips finite numeric values serialized in exponent notation', () => {
    const { source } = createDatabase();
    const amount = property(source, 'Amount', 'number');
    importDatabaseCsv(source, 'Title,Amount\nLarge,1e21\nSmall,-2.5e-30');
    const csv = exportDatabaseCsv(source);
    importDatabaseCsv(source, csv);
    expect(
      source.rows$.value.map(row => source.cellValueGet(row, amount))
    ).toEqual([1e21, -2.5e-30, 1e21, -2.5e-30]);
  });

  test.each([
    ['checkbox', 'perhaps'],
    ['progress', 'garbage'],
    ['date', '2026-02-30'],
    ['number', '12garbage'],
    ['number', 'Infinity'],
    ['select', '["A","B"]'],
    ['multi-select', '[invalid JSON]'],
    ['created-time', '2026-10-05 12:00:00'],
  ])(
    'rejects unsupported or lossy %s values without adding rows',
    (type, value) => {
      const { source } = createDatabase();
      property(source, 'Value', type);
      expect(() =>
        importDatabaseCsv(
          source,
          stringifyCsv([
            ['Title', 'Value'],
            ['Row', value],
          ])
        )
      ).toThrow(/record 2.*Value/);
      expect(source.rows$.value).toEqual([]);
    }
  );

  test('readers can export but cannot import', () => {
    const { source, model } = createDatabase();
    importDatabaseCsv(source, 'Title\nExisting');
    const reader = new DatabaseBlockDataSource(
      model,
      undefined,
      signal('member'),
      signal(false)
    );
    expect(parseCsv(exportDatabaseCsv(reader))).toEqual([
      ['Title'],
      ['Existing'],
    ]);
    expect(() => importDatabaseCsv(reader, 'Title\nDenied')).toThrow(
      /permission/
    );
    expect(reader.rows$.value).toHaveLength(1);
  });
});

import type { PropertyMetaConfig } from '@blocksuite/data-view';
import type { Text } from '@blocksuite/store';

import type { DatabaseBlockDataSource } from '../data-source.js';

/** Parse the complete file before any database changes are made. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  if (!text) throw new Error('The CSV file is empty.');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const finishCell = () => {
    row.push(cell);
    cell = '';
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        cell += char;
      }
    } else if (char === ',') {
      finishCell();
    } else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"' && !cell && !closed) {
      quoted = true;
    } else {
      if (closed || char === '"') {
        throw new Error(`Invalid CSV quoting in record ${rows.length + 1}.`);
      }
      cell += char;
    }
  }
  if (quoted) throw new Error('The CSV file contains an unclosed quoted cell.');
  if (cell || row.length || closed || !/[\r\n]$/.test(text)) finishRow();
  const width = rows[0]?.length;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.length !== width) {
      throw new Error(
        `CSV record ${i + 1} has ${rows[i]?.length} cells; expected ${width}.`
      );
    }
  }
  return rows;
}

export function stringifyCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map(row =>
      row
        .map(cell =>
          /[",\r\n]/.test(cell) || cell === ''
            ? `"${cell.replace(/"/g, '""')}"`
            : cell
        )
        .join(',')
    )
    .join('\r\n');
}

export function exportDatabaseCsv(source: DatabaseBlockDataSource): string {
  // Generated metadata is not assignable when new rows are appended.
  const properties = source.properties$.value.filter(id => {
    const type = source.propertyTypeGet(id);
    return (
      type === 'title' ||
      (!source.propertyReadonlyGet(id) &&
        !!type &&
        !source.isSpacialProperty(type))
    );
  });
  const headers = properties.map(id => source.propertyNameGet(id));
  if (
    headers.some(name => !name.trim()) ||
    new Set(headers).size !== headers.length
  ) {
    throw new Error('CSV export requires unique, nonempty column names.');
  }
  const rows = [headers];
  for (const rowId of source.rows$.value) {
    rows.push(
      properties.map(id => {
        const type = source.propertyTypeGet(id);
        const meta = type && source.propertyMetaGet(type);
        if (!meta)
          throw new Error(
            `Cannot export column "${source.propertyNameGet(id)}": unknown property type.`
          );
        if (type === 'select' || type === 'multi-select') {
          const value =
            source.cellValueGet(rowId, id) ?? meta.config.rawValue.default();
          const parsed = meta.config.rawValue.schema.safeParse(value);
          if (!parsed.success)
            throw new Error(`Cannot export invalid ${type} value.`);
          const ids =
            type === 'select'
              ? value == null
                ? []
                : [value]
              : (value as string[]);
          const options = source.propertyDataGet(id).options as TagOption[];
          return JSON.stringify(
            ids.map(id => {
              const option = options.find(option => option.id === id);
              if (!option)
                throw new Error(
                  `Cannot export missing select option in "${source.propertyNameGet(id)}".`
                );
              return option.value;
            })
          );
        }
        if (type === 'title') {
          const value = meta.config.rawValue.toJson({
            value: source.cellValueGet(rowId, id),
            data: source.propertyDataGet(id),
            dataSource: source,
          });
          return typeof value === 'string' ? value : '';
        }
        return meta.config.rawValue.toString({
          value:
            source.cellValueGet(rowId, id) ?? meta.config.rawValue.default(),
          data: source.propertyDataGet(id),
        });
      })
    );
  }
  return '\uFEFF' + stringifyCsv(rows) + '\r\n';
}

type ImportColumn = {
  id?: string;
  name: string;
  type: string;
  meta: PropertyMetaConfig;
  data: Record<string, unknown>;
  changedData: boolean;
  readonly: boolean;
};

const supportedTypes: Record<string, true> = {
  title: true,
  'rich-text': true,
  text: true,
  link: true,
  image: true,
  number: true,
  progress: true,
  checkbox: true,
  date: true,
  select: true,
  'multi-select': true,
};

type TagOption = { id: string; value: string };

function parseTags(
  column: ImportColumn,
  text: string,
  source: DatabaseBlockDataSource
): unknown {
  const decoded: unknown = text.trimStart().startsWith('[')
    ? JSON.parse(text)
    : column.type === 'select'
      ? [text]
      : text.split(',').map(label => label.trim());
  if (
    !Array.isArray(decoded) ||
    !decoded.every(label => typeof label === 'string') ||
    (column.type === 'select' && decoded.length > 1)
  ) {
    throw new Error(
      'Expected a JSON array of labels (at most one label for Select).'
    );
  }
  const ids: string[] = [];
  for (const label of decoded as string[]) {
    let options = column.data.options as TagOption[];
    let option = options.find(option => option.value === label);
    if (!option) {
      const addGroup = column.meta.config.addGroup;
      if (!addGroup)
        throw new Error('This property cannot create select options.');
      const next = column.meta.config.propertyData.schema.parse(
        addGroup({
          text: label,
          oldData: column.data,
          dataSource: source,
        })
      ) as Record<string, unknown>;
      column.data = next;
      column.changedData = true;
      options = next.options as TagOption[];
      option = options.find(option => option.value === label);
    }
    if (!option) throw new Error('Could not resolve select label.');
    ids.push(option.id);
  }
  const raw = column.meta.config.rawValue;
  const parsed = raw.fromJson?.({
    value: column.type === 'select' ? (ids[0] ?? null) : ids,
    data: column.data,
    dataSource: source,
  });
  return raw.schema.parse(parsed);
}

function parseValue(
  column: ImportColumn,
  text: string,
  source: DatabaseBlockDataSource
): unknown {
  const raw = column.meta.config.rawValue;
  if (!text) return raw.default();
  if (supportedTypes[column.type] !== true) {
    throw new Error(
      `Property type "${column.type}" does not support CSV import.`
    );
  }
  if (column.type === 'select' || column.type === 'multi-select') {
    return parseTags(column, text, source);
  }
  const normalized = text.trim();
  // These UI parsers intentionally coerce invalid input. CSV must not lose it.
  if (
    (column.type === 'number' || column.type === 'progress') &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)
  ) {
    throw new Error('Expected a finite number.');
  }
  if (column.type === 'number' || column.type === 'progress') {
    const value = Number(normalized);
    if (!Number.isFinite(value) || !raw.fromJson) {
      throw new Error('Expected a finite number.');
    }
    return raw.schema.parse(
      raw.fromJson({ value, data: column.data, dataSource: source })
    );
  }
  if (
    column.type === 'checkbox' &&
    !/^(true|false|yes|no|1|0|undefined|null|是|否|不|错|错误|取消|关闭)$/i.test(
      normalized
    )
  ) {
    throw new Error('Expected a boolean (True/False, Yes/No, or 1/0).');
  }
  const parsed = raw.fromString({
    value: text,
    data: column.data,
    dataSource: source,
  });
  if (parsed.data) {
    column.data = parsed.data;
    column.changedData = true;
  }
  const result = raw.schema.safeParse(parsed.value);
  if (
    !result.success ||
    (typeof parsed.value === 'number' && !Number.isFinite(parsed.value)) ||
    parsed.value == null
  ) {
    throw new Error(`Invalid ${column.type} value.`);
  }
  if (
    column.type === 'date' &&
    raw.toString({ value: result.data, data: column.data }) !== text
  ) {
    throw new Error('Expected a valid date in YYYY-MM-DD format.');
  }
  return result.data;
}

/** Append rows only after every header and typed cell has passed validation. */
export function importDatabaseCsv(
  source: DatabaseBlockDataSource,
  input: string
): number {
  if (source.readonly$.value)
    throw new Error('You do not have permission to edit this database.');
  const [headers, ...records] = parseCsv(input);
  if (!headers || headers.some(header => !header.trim())) {
    throw new Error('CSV column names must not be empty.');
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV column names must be unique.');
  }
  const properties = source.properties$.value;
  const titleId = properties.find(id => source.propertyTypeGet(id) === 'title');
  if (!titleId) throw new Error('The database has no title column.');
  const titleIndex = headers.indexOf(source.propertyNameGet(titleId));
  const columns: ImportColumn[] = headers.map((name, index) => {
    const matches = properties.filter(
      id => source.propertyNameGet(id) === name
    );
    if (matches.length > 1)
      throw new Error(`Database column "${name}" is ambiguous.`);
    const id =
      index === (titleIndex < 0 ? 0 : titleIndex) ? titleId : matches[0];
    const type = id ? source.propertyTypeGet(id) : 'rich-text';
    const meta = type && source.propertyMetaGet(type);
    if (!type || !meta)
      throw new Error(`Cannot import column "${name}": unknown property type.`);
    return {
      id,
      name,
      type,
      meta,
      // Stored property data may be Yjs-backed proxies, so use the existing
      // database JSON-cloning convention rather than structuredClone.
      data: JSON.parse(
        JSON.stringify(
          id ? source.propertyDataGet(id) : meta.config.propertyData.default()
        )
      ),
      changedData: false,
      readonly:
        !!id &&
        (source.propertyReadonlyGet(id) ||
          (type !== 'title' && source.isSpacialProperty(type))),
    };
  });
  const values = records.map((record, rowIndex) =>
    record.map((text, columnIndex) => {
      const column = columns[columnIndex];
      if (!column) throw new Error('Missing CSV column.');
      try {
        if (column.readonly) {
          if (text)
            throw new Error(
              'This column is generated by the database and cannot be imported.'
            );
          return undefined;
        }
        return parseValue(column, text, source);
      } catch (error) {
        throw new Error(
          `CSV record ${rowIndex + 2}, column "${column.name}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })
  );
  // Header-only files validate successfully without adding columns or rows.
  if (!records.length) return 0;
  if (source.readonly$.value)
    throw new Error('You do not have permission to edit this database.');
  source.doc.captureSync();
  const firstRowIndex = source.rows$.value.length;
  const titleColumnIndex = columns.findIndex(column => column.type === 'title');
  for (const column of columns) {
    if (!column.id) {
      column.id = source.propertyAdd('end', {
        name: column.name,
        type: column.type,
      });
      if (!column.id) throw new Error(`Cannot create column "${column.name}".`);
    }
    if (column.changedData) source.propertyDataSet(column.id, column.data);
  }
  // Flush schema signals before setters resolve the newly created columns.
  source.doc.transact(() => {
    for (const [rowIndex, record] of values.entries()) {
      // Child model signals update after the transaction; initialize title text
      // with the row and use explicit indices to preserve CSV order.
      const rowId = source.rowAdd(
        firstRowIndex + rowIndex,
        record[titleColumnIndex] as Text | undefined
      );
      columns.forEach((column, index) => {
        if (column.id && !column.readonly && column.type !== 'title') {
          source.cellValueChange(rowId, column.id, record[index]);
        }
      });
    }
  });
  source.doc.captureSync();
  return records.length;
}

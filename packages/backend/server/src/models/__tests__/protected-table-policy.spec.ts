import test from 'ava';

import { projectProtectedTable } from '../protected-table-policy';

const table = {
  columns: [
    { id: 'task', name: 'Task' },
    { id: 'leader', name: 'Leader note' },
  ],
  rows: [
    { id: 'assigned', values: { task: 'Fix bug', leader: 'Private note' } },
    { id: 'other', values: { task: 'Review budget', leader: 'Secret' } },
  ],
};

test('a member receives no rows or columns without grants', t => {
  const result = projectProtectedTable({ ...table, grants: [] }, false, false);
  t.deepEqual(result.columns, []);
  t.deepEqual(result.rows, []);
  t.false(JSON.stringify(result).includes('Secret'));
});

test('both row and column grants are needed to receive a cell', t => {
  const result = projectProtectedTable(
    {
      ...table,
      grants: [
        { scope: 'row', resourceId: 'assigned', canRead: true, canWrite: true },
        { scope: 'column', resourceId: 'task', canRead: true, canWrite: false },
      ],
    },
    false,
    true
  );
  t.deepEqual(result.columns, [
    { id: 'task', name: 'Task', canWrite: false },
  ]);
  t.deepEqual(result.rows, [
    { id: 'assigned', canWrite: true, values: { task: 'Fix bug' } },
  ]);
  t.false(JSON.stringify(result).includes('Private note'));
  t.false(JSON.stringify(result).includes('Review budget'));
});

test('an admin can read all cells', t => {
  const result = projectProtectedTable({ ...table, grants: [] }, true, true);
  t.is(result.rows.length, 2);
  t.is(result.columns.length, 2);
  t.is(result.rows[1]?.values.leader, 'Secret');
});

test('a document reader cannot edit even with write grants', t => {
  const result = projectProtectedTable(
    {
      ...table,
      grants: [
        { scope: 'row', resourceId: 'assigned', canRead: true, canWrite: true },
        { scope: 'column', resourceId: 'task', canRead: true, canWrite: true },
      ],
    },
    false,
    false
  );
  t.false(result.rows[0]?.canWrite);
  t.false(result.columns[0]?.canWrite);
});

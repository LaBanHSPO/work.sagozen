type Column = { id: string; name: string };
type Row = { id: string; values: unknown };
type Grant = {
  scope: string;
  resourceId: string;
  canRead: boolean;
  canWrite: boolean;
};

export function projectProtectedTable(
  table: { columns: Column[]; rows: Row[]; grants: Grant[] },
  canManage: boolean,
  canEdit: boolean
) {
  const rowGrants = new Map(
    table.grants
      .filter(grant => grant.scope === 'row')
      .map(grant => [grant.resourceId, grant])
  );
  const columnGrants = new Map(
    table.grants
      .filter(grant => grant.scope === 'column')
      .map(grant => [grant.resourceId, grant])
  );
  const columns = table.columns
    .filter(column => canManage || columnGrants.get(column.id)?.canRead)
    .map(column => ({
      id: column.id,
      name: column.name,
      canWrite: canEdit && (canManage || !!columnGrants.get(column.id)?.canWrite),
    }));
  const rows = table.rows
    .filter(row => canManage || rowGrants.get(row.id)?.canRead)
    .map(row => {
      const rawValues =
        row.values && typeof row.values === 'object' && !Array.isArray(row.values)
          ? (row.values as Record<string, unknown>)
          : {};
      return {
        id: row.id,
        canWrite: canEdit && (canManage || !!rowGrants.get(row.id)?.canWrite),
        values: Object.fromEntries(
          columns.map(column => [
            column.id,
            typeof rawValues[column.id] === 'string'
              ? rawValues[column.id]
              : '',
          ])
        ),
      };
    });
  return { canManage, columns, rows };
}

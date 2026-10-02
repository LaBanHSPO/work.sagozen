import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BaseModel } from './base';
import { projectProtectedTable } from './protected-table-policy';

export type ProtectedTableKey = {
  workspaceId: string;
  docId: string;
  blockId: string;
};

type Scope = 'row' | 'column';

const keyWhere = (key: ProtectedTableKey) => ({
  workspaceId_docId_blockId: key,
});

const grantWhere = (
  key: ProtectedTableKey,
  scope: Scope,
  resourceId: string,
  userId: string
) => ({
  workspaceId_docId_blockId_scope_resourceId_userId: {
    ...key,
    scope,
    resourceId,
    userId,
  },
});

@Injectable()
export class ProtectedTableModel extends BaseModel {
  async exists(key: ProtectedTableKey) {
    return !!(await this.db.protectedTable.findUnique({ where: keyWhere(key) }));
  }

  async delete(key: ProtectedTableKey) {
    await this.db.protectedTable.deleteMany({ where: key });
  }

  async create(key: ProtectedTableKey) {
    return await this.db.protectedTable.upsert({
      where: keyWhere(key),
      update: {},
      create: {
        ...key,
        columns: {
          create: ['Task', 'Status', 'Assignee', 'Due date'].map(
            (name, position) => ({ id: randomUUID(), name, position })
          ),
        },
      },
    });
  }

  async read(
    key: ProtectedTableKey,
    userId: string,
    canManage: boolean,
    canEdit: boolean
  ) {
    const table = await this.db.protectedTable.findUnique({
      where: keyWhere(key),
      include: {
        columns: { orderBy: { position: 'asc' } },
        rows: { orderBy: { position: 'asc' } },
        grants: { where: { userId } },
      },
    });
    if (!table) return null;
    return { exists: true, ...projectProtectedTable(table, canManage, canEdit) };
  }

  async readGrants(key: ProtectedTableKey) {
    return await this.db.protectedTableGrant.findMany({
      where: key,
      orderBy: [{ scope: 'asc' }, { resourceId: 'asc' }, { userId: 'asc' }],
    });
  }

  async addColumn(key: ProtectedTableKey, name: string) {
    const position = await this.db.protectedTableColumn.count({ where: key });
    return await this.db.protectedTableColumn.create({
      data: { ...key, id: randomUUID(), name, position },
    });
  }

  async addRow(key: ProtectedTableKey) {
    const position = await this.db.protectedTableRow.count({ where: key });
    return await this.db.protectedTableRow.create({
      data: { ...key, id: randomUUID(), position, values: {} },
    });
  }

  async setGrant(
    key: ProtectedTableKey,
    scope: Scope,
    resourceId: string,
    userId: string,
    canRead: boolean,
    canWrite: boolean
  ) {
    const exists =
      scope === 'row'
        ? await this.db.protectedTableRow.findUnique({
            where: { workspaceId_docId_blockId_id: { ...key, id: resourceId } },
          })
        : await this.db.protectedTableColumn.findUnique({
            where: { workspaceId_docId_blockId_id: { ...key, id: resourceId } },
          });
    if (!exists) return false;
    const where = grantWhere(key, scope, resourceId, userId);
    if (!canRead && !canWrite) {
      await this.db.protectedTableGrant.deleteMany({
        where: { ...key, scope, resourceId, userId },
      });
    } else {
      await this.db.protectedTableGrant.upsert({
        where,
        create: { ...key, scope, resourceId, userId, canRead, canWrite },
        update: { canRead, canWrite },
      });
    }
    return true;
  }

  async writeCell(
    key: ProtectedTableKey,
    rowId: string,
    columnId: string,
    userId: string,
    canManage: boolean,
    value: string
  ) {
    const allowed = canManage
      ? Prisma.sql`TRUE`
      : Prisma.sql`
          EXISTS (
            SELECT 1 FROM protected_table_grants grant_row
            WHERE grant_row.workspace_id = ${key.workspaceId}
              AND grant_row.doc_id = ${key.docId}
              AND grant_row.block_id = ${key.blockId}
              AND grant_row.scope = 'row'
              AND grant_row.resource_id = ${rowId}
              AND grant_row.user_id = ${userId}
              AND grant_row.can_read AND grant_row.can_write
          ) AND EXISTS (
            SELECT 1 FROM protected_table_grants grant_column
            WHERE grant_column.workspace_id = ${key.workspaceId}
              AND grant_column.doc_id = ${key.docId}
              AND grant_column.block_id = ${key.blockId}
              AND grant_column.scope = 'column'
              AND grant_column.resource_id = ${columnId}
              AND grant_column.user_id = ${userId}
              AND grant_column.can_read AND grant_column.can_write
          )`;
    const updated = await this.db.$executeRaw(Prisma.sql`
      UPDATE protected_table_rows AS task_row
      SET "values" = jsonb_set(task_row."values", ARRAY[${columnId}]::text[], to_jsonb(${value}::text), true)
      WHERE task_row.workspace_id = ${key.workspaceId}
        AND task_row.doc_id = ${key.docId}
        AND task_row.block_id = ${key.blockId}
        AND task_row.id = ${rowId}
        AND EXISTS (
          SELECT 1 FROM protected_table_columns AS task_column
          WHERE task_column.workspace_id = task_row.workspace_id
            AND task_column.doc_id = task_row.doc_id
            AND task_column.block_id = task_row.block_id
            AND task_column.id = ${columnId}
        )
        AND ${allowed}
    `);
    return updated === 1;
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { applyUpdate, Doc as YDoc, Map as YMap } from 'yjs';

import { DocActionDenied } from '../../base';
import { Models, DocRole, WorkspaceRole } from '../../models';
import type { ProtectedTableKey } from '../../models/protected-table';
import { CurrentUser } from '../auth';
import { DocReader } from '../doc/reader';
import { PermissionAccess } from '../permission';

const MAX_CELL_LENGTH = 10000;

@Controller('/api/workspaces/:workspaceId/docs/:docId/protected-tables/:blockId')
export class ProtectedTableController {
  constructor(
    private readonly models: Models,
    private readonly ac: PermissionAccess,
    private readonly docReader: DocReader
  ) {}

  private async requireProtectedBlock(key: ProtectedTableKey) {
    const record = await this.docReader.getDoc(key.workspaceId, key.docId);
    if (!record) throw new NotFoundException('Protected table block not found');

    const doc = new YDoc();
    try {
      applyUpdate(doc, record.bin);
      const block = doc.getMap('blocks').get(key.blockId);
      if (
        !(block instanceof YMap) ||
        block.get('sys:flavour') !== 'affine:database' ||
        block.get('prop:protectedTable') !== true
      ) {
        throw new NotFoundException('Protected table block not found');
      }
    } finally {
      doc.destroy();
    }
  }

  private async access(userId: string, key: ProtectedTableKey) {
    const workspaceAccess = await this.ac
      .user(userId)
      .workspace(key.workspaceId)
      .permissions();
    const docAccess = await this.ac
      .user(userId)
      .doc(key.workspaceId, key.docId)
      .permissions();
    const canManage =
      workspaceAccess.role === WorkspaceRole.Owner ||
      workspaceAccess.role === WorkspaceRole.Admin ||
      docAccess.role === DocRole.Owner;
    return { canManage, docAccess };
  }

  private async requireRead(userId: string, key: ProtectedTableKey) {
    const access = await this.access(userId, key);
    if (!access.docAccess.permissions['Doc.Read']) {
      throw new DocActionDenied({
        action: 'Doc.Read',
        docId: key.docId,
        spaceId: key.workspaceId,
      });
    }
    await this.requireProtectedBlock(key);
    return access;
  }

  private async requireManage(userId: string, key: ProtectedTableKey) {
    const access = await this.requireRead(userId, key);
    if (!access.canManage || !access.docAccess.permissions['Doc.Update']) {
      throw new DocActionDenied({
        action: 'Doc.Users.Manage',
        docId: key.docId,
        spaceId: key.workspaceId,
      });
    }
  }

  private async requireTable(key: ProtectedTableKey) {
    if (!(await this.models.protectedTable.exists(key))) {
      throw new NotFoundException('Protected table not found');
    }
  }

  private requireJson(req: Request) {
    if (!req.is('application/json')) {
      throw new BadRequestException('JSON request required');
    }
  }

  @Post()
  async create(
    @CurrentUser() user: CurrentUser,
    @Param() key: ProtectedTableKey,
    @Req() req: Request
  ) {
    this.requireJson(req);
    await this.requireManage(user.id, key);
    await this.models.protectedTable.create(key);
    return { created: true };
  }

  @Delete()
  async delete(
    @CurrentUser() user: CurrentUser,
    @Param() key: ProtectedTableKey
  ) {
    await this.requireManage(user.id, key);
    await this.models.protectedTable.delete(key);
    return { deleted: true };
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async read(
    @CurrentUser() user: CurrentUser,
    @Param() key: ProtectedTableKey
  ) {
    const { canManage, docAccess } = await this.requireRead(user.id, key);
    const table = await this.models.protectedTable.read(
      key,
      user.id,
      canManage,
      docAccess.permissions['Doc.Update']
    );
    return table ?? { exists: false, canManage, columns: [], rows: [] };
  }

  @Get('members')
  @Header('Cache-Control', 'private, no-store')
  async members(
    @CurrentUser() user: CurrentUser,
    @Param() key: ProtectedTableKey
  ) {
    await this.requireManage(user.id, key);
    const members = await this.models.workspaceUser.adminListMembers(
      key.workspaceId,
      { first: 500, offset: 0 }
    );
    return members
      .filter(member => member.status === 'Accepted')
      .map(member => ({ id: member.id, name: member.name, email: member.email }));
  }

  @Get('grants')
  @Header('Cache-Control', 'private, no-store')
  async grants(
    @CurrentUser() user: CurrentUser,
    @Param() key: ProtectedTableKey
  ) {
    await this.requireManage(user.id, key);
    await this.requireTable(key);
    return await this.models.protectedTable.readGrants(key);
  }

  @Post('columns')
  async addColumn(
    @CurrentUser() user: CurrentUser,
    @Param() key: ProtectedTableKey,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    this.requireJson(req);
    await this.requireManage(user.id, key);
    await this.requireTable(key);
    const name = (body as { name?: unknown } | null)?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 120) {
      throw new BadRequestException('Column name must be 1 to 120 characters');
    }
    return await this.models.protectedTable.addColumn(key, name.trim());
  }

  @Post('rows')
  async addRow(
    @CurrentUser() user: CurrentUser,
    @Param() key: ProtectedTableKey,
    @Req() req: Request
  ) {
    this.requireJson(req);
    await this.requireManage(user.id, key);
    await this.requireTable(key);
    return await this.models.protectedTable.addRow(key);
  }

  @Put('grants')
  async setGrant(
    @CurrentUser() user: CurrentUser,
    @Param() key: ProtectedTableKey,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    this.requireJson(req);
    await this.requireManage(user.id, key);
    await this.requireTable(key);
    const input = body as Record<string, unknown> | null;
    const { scope, resourceId, userId, canRead, canWrite } = input ?? {};
    if (
      (scope !== 'row' && scope !== 'column') ||
      typeof resourceId !== 'string' ||
      typeof userId !== 'string' ||
      typeof canRead !== 'boolean' ||
      typeof canWrite !== 'boolean' ||
      (canWrite && !canRead)
    ) {
      throw new BadRequestException('Invalid grant');
    }
    if (!(await this.models.workspaceUser.getActive(key.workspaceId, userId))) {
      throw new BadRequestException('User must be an active workspace member');
    }
    if (
      canRead &&
      !(await this.ac.user(userId).doc(key.workspaceId, key.docId).can('Doc.Read'))
    ) {
      throw new BadRequestException('User needs access to this document');
    }
    if (
      canWrite &&
      !(await this.ac.user(userId).doc(key.workspaceId, key.docId).can('Doc.Update'))
    ) {
      throw new BadRequestException('User needs edit access to this document');
    }
    const updated = await this.models.protectedTable.setGrant(
      key,
      scope,
      resourceId,
      userId,
      canRead,
      canWrite
    );
    if (!updated) throw new NotFoundException('Row or column not found');
    return { updated: true };
  }

  @Put('cells/:rowId/:columnId')
  async writeCell(
    @CurrentUser() user: CurrentUser,
    @Param() params: ProtectedTableKey & { rowId: string; columnId: string },
    @Body() body: unknown,
    @Req() req: Request
  ) {
    this.requireJson(req);
    const { rowId, columnId, ...key } = params;
    const { canManage, docAccess } = await this.requireRead(user.id, key);
    if (!docAccess.permissions['Doc.Update']) {
      throw new DocActionDenied({
        action: 'Doc.Update',
        docId: key.docId,
        spaceId: key.workspaceId,
      });
    }
    const value = (body as { value?: unknown } | null)?.value;
    if (typeof value !== 'string' || value.length > MAX_CELL_LENGTH) {
      throw new BadRequestException('Cell value must be text under 10000 characters');
    }
    const written = await this.models.protectedTable.writeCell(
      key,
      rowId,
      columnId,
      user.id,
      canManage,
      value
    );
    if (!written) {
      throw new DocActionDenied({
        action: 'Doc.Update',
        docId: key.docId,
        spaceId: key.workspaceId,
      });
    }
    return { updated: true };
  }
}

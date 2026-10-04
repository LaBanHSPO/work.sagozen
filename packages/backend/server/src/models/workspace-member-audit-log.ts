import { Injectable } from '@nestjs/common';

import { BaseModel } from './base';

export type MemberAuditAction =
  | 'invited'
  | 'approved'
  | 'declined'
  | 'role_changed'
  | 'removed'
  | 'joined'
  | 'left'
  | 'invite_link_created'
  | 'invite_link_revoked'
  | 'doc_published';

export type MemberAuditInput = {
  workspaceId: string;
  actorUserId: string;
  targetUserId?: string;
  targetEmail?: string;
  action: MemberAuditAction;
  detail?: string;
};

@Injectable()
export class WorkspaceMemberAuditLogModel extends BaseModel {
  async record(input: MemberAuditInput) {
    return this.recordMany([input]);
  }

  async recordMany(inputs: MemberAuditInput[]) {
    if (inputs.length === 0) return;
    const users = await this.db.user.findMany({
      where: {
        id: {
          in: inputs.flatMap(input =>
            input.targetUserId
              ? [input.actorUserId, input.targetUserId]
              : [input.actorUserId]
          ),
        },
      },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map(user => [user.id, user]));
    return this.db.workspaceMemberAuditLog.createMany({
      data: inputs.map(input => ({
        ...input,
        actorName: byId.get(input.actorUserId)?.name ?? input.actorUserId,
        actorEmail: byId.get(input.actorUserId)?.email ?? null,
        targetName:
          (input.targetUserId && byId.get(input.targetUserId)?.name) ??
          input.targetEmail ??
          input.targetUserId ??
          null,
        targetEmail:
          input.targetEmail ??
          (input.targetUserId && byId.get(input.targetUserId)?.email) ??
          null,
      })),
    });
  }

  async list(workspaceId: string, skip: number, take: number) {
    return this.db.workspaceMemberAuditLog.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    });
  }
}

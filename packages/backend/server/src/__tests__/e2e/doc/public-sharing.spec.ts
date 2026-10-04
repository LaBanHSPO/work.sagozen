import {
  listNotificationsQuery,
  NotificationType,
  publishPageMutation,
  readNotificationMutation,
  workspaceMemberAuditLogsQuery,
} from '@affine/graphql';

import { NotificationService } from '../../../core/notification/service';
import { WorkspaceRole } from '../../../models';
import { Mockers } from '../../mocks';
import { app, e2e } from '../test';

e2e(
  'public sharing by a member notifies managers and records activity',
  async t => {
    const owner = await app.create(Mockers.User);
    const admin = await app.create(Mockers.User);
    const member = await app.create(Mockers.User);
    const workspace = await app.create(Mockers.Workspace, {
      owner: { id: owner.id },
    });
    await app.create(Mockers.TeamWorkspace, { id: workspace.id, quantity: 3 });
    for (const [user, type] of [
      [admin, WorkspaceRole.Admin],
      [member, WorkspaceRole.Collaborator],
    ] as const) {
      await app.create(Mockers.WorkspaceUser, {
        workspaceId: workspace.id,
        userId: user.id,
        type,
      });
    }
    const snapshot = await app.create(Mockers.DocSnapshot, {
      workspaceId: workspace.id,
      user: member,
    });
    await app.create(Mockers.DocMeta, {
      workspaceId: workspace.id,
      docId: snapshot.id,
      title: 'Shared document',
    });
    await app.login(member);
    const variables = { workspaceId: workspace.id, pageId: snapshot.id };
    const published = await app.gql({ query: publishPageMutation, variables });
    t.is(published.publishDoc.id, snapshot.id);
    await app.gql({ query: publishPageMutation, variables });
    t.is(await app.models.notification.countByUserId(member.id), 0);

    for (const manager of [owner, admin]) {
      await app.login(manager);
      const result = await app.gql({
        query: listNotificationsQuery,
        variables: { pagination: { first: 10 }, read: false },
      });
      const notifications = result.currentUser!.notifications;
      t.is(notifications.totalCount, 1);
      const notification = notifications.edges[0].node;
      t.is(notification.type, NotificationType.DocPublished);
      t.is(notification.body.createdByUser.id, member.id);
      t.is(notification.body.workspace.id, workspace.id);
      t.deepEqual(notification.body.doc, {
        id: snapshot.id,
        title: 'Shared document',
        mode: 'page',
      });
      await app.gql({
        query: readNotificationMutation,
        variables: { id: notification.id },
      });
      t.is(await app.get(NotificationService).countByUserId(manager.id), 0);
      const activity = await app.gql({
        query: workspaceMemberAuditLogsQuery,
        variables: { workspaceId: workspace.id, skip: 0, take: 20 },
      });
      t.is(activity.workspaceMemberAuditLogs.length, 1);
      const [log] = activity.workspaceMemberAuditLogs;
      t.is(log.action, 'doc_published');
      t.is(log.actorName, member.name);
      t.is(log.actorEmail, member.email);
      t.is(log.detail, `Shared document (${snapshot.id})`);
    }
  }
);

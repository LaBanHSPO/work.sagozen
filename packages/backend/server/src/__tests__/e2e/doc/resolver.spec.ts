import { randomUUID } from 'node:crypto';

import {
  DocRole as GraphQLDocRole,
  getRecentlyUpdatedDocsQuery,
  getWorkspacePageByIdQuery,
  type GraphQLQuery,
  publishPageMutation,
} from '@affine/graphql';
import { PrismaClient } from '@prisma/client';

import { PermissionAccess } from '../../../core/permission';
import { DocRole, WorkspaceRole } from '../../../models';
import { Mockers } from '../../mocks';
import { app, e2e } from '../test';

e2e('should get recently updated docs', async t => {
  const owner = await app.signup();

  const workspace = await app.create(Mockers.Workspace, {
    owner: { id: owner.id },
  });

  const docSnapshot1 = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  const doc1 = await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: docSnapshot1.id,
    title: 'doc1',
  });

  const docSnapshot2 = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  const doc2 = await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: docSnapshot2.id,
    title: 'doc2',
  });

  const docSnapshot3 = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  const doc3 = await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: docSnapshot3.id,
    title: 'doc3',
  });

  const {
    workspace: { recentlyUpdatedDocs },
  } = await app.gql({
    query: getRecentlyUpdatedDocsQuery,
    variables: {
      workspaceId: workspace.id,
      pagination: {
        first: 10,
      },
    },
  });

  t.is(recentlyUpdatedDocs.totalCount, 3);
  t.is(recentlyUpdatedDocs.edges[0].node.id, doc3.docId);
  t.is(recentlyUpdatedDocs.edges[0].node.title, doc3.title);
  t.is(recentlyUpdatedDocs.edges[1].node.id, doc2.docId);
  t.is(recentlyUpdatedDocs.edges[1].node.title, doc2.title);
  t.is(recentlyUpdatedDocs.edges[2].node.id, doc1.docId);
  t.is(recentlyUpdatedDocs.edges[2].node.title, doc1.title);
});

e2e('should filter recently updated docs by doc read permission', async t => {
  const owner = await app.signup();
  const member = await app.createUser();
  await app.login(member);

  await app.switchUser(owner);
  const workspace = await app.create(Mockers.Workspace, {
    owner: { id: owner.id },
  });
  await app.create(Mockers.WorkspaceUser, {
    workspaceId: workspace.id,
    userId: member.id,
    type: WorkspaceRole.Collaborator,
  });

  const privateSnapshot = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: privateSnapshot.id,
    title: 'private-doc',
    defaultRole: DocRole.None,
  });

  const publicSnapshot = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  const publicDoc = await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: publicSnapshot.id,
    title: 'public-doc',
    defaultRole: DocRole.None,
    public: true,
  });

  await app.switchUser(member);
  const {
    workspace: { recentlyUpdatedDocs },
  } = await app.gql({
    query: getRecentlyUpdatedDocsQuery,
    variables: {
      workspaceId: workspace.id,
      pagination: {
        first: 10,
      },
    },
  });

  t.is(recentlyUpdatedDocs.totalCount, 1);
  t.deepEqual(
    recentlyUpdatedDocs.edges.map(edge => edge.node.id),
    [publicDoc.docId]
  );
});

e2e('should reject publishing when doc snapshot does not exist', async t => {
  const owner = await app.signup();

  const workspace = await app.create(Mockers.Workspace, {
    owner: { id: owner.id },
  });

  const docId = randomUUID();

  const result1 = await app.gql({
    query: getWorkspacePageByIdQuery,
    variables: { workspaceId: workspace.id, pageId: docId },
  });

  t.is(result1.workspace.doc.public, false);

  await t.throwsAsync(
    app.gql({
      query: publishPageMutation,
      variables: { workspaceId: workspace.id, pageId: docId },
    }),
    {
      message: `Doc ${docId} under Space ${workspace.id} not found.`,
    }
  );
});

e2e('should get doc with title and summary', async t => {
  const owner = await app.signup();

  const workspace = await app.create(Mockers.Workspace, {
    owner: { id: owner.id },
  });

  const docSnapshot = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  const doc = await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: docSnapshot.id,
    title: 'doc1',
    summary: 'summary1',
  });

  const result = await app.gql({
    query: getWorkspacePageByIdQuery,
    variables: { workspaceId: workspace.id, pageId: doc.docId },
  });

  t.is(result.workspace.doc.title, doc.title);
  t.is(result.workspace.doc.summary, doc.summary);
});

e2e('should get doc with title and null summary', async t => {
  const owner = await app.signup();

  const workspace = await app.create(Mockers.Workspace, {
    owner: { id: owner.id },
  });

  const docSnapshot = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  const doc = await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: docSnapshot.id,
    title: 'doc1',
  });

  const result = await app.gql({
    query: getWorkspacePageByIdQuery,
    variables: { workspaceId: workspace.id, pageId: doc.docId },
  });

  t.is(result.workspace.doc.title, doc.title);
  t.is(result.workspace.doc.summary, null);
});

e2e('should require owner or admin to query workspace docs', async t => {
  const owner = await app.signup();
  const member = await app.createUser();
  await app.login(member);

  await app.switchUser(owner);
  const workspace = await app.create(Mockers.Workspace, {
    owner: { id: owner.id },
  });
  await app.create(Mockers.WorkspaceUser, {
    workspaceId: workspace.id,
    userId: member.id,
    type: WorkspaceRole.Collaborator,
  });

  const docSnapshot = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: docSnapshot.id,
    title: 'private-doc',
    defaultRole: DocRole.None,
  });

  await app.switchUser(member);
  await t.throwsAsync(
    app.gql({
      query: {
        id: 'workspaceDocsPermissionCheck',
        op: 'workspaceDocsPermissionCheck',
        query: `
          query {
            workspace(id: "${workspace.id}") {
              docs(pagination: { first: 10 }) {
                totalCount
              }
            }
          }
        `,
      } satisfies GraphQLQuery,
      variables: undefined,
    })
  );
});

e2e('should require Doc.Read to query workspace page meta', async t => {
  const owner = await app.signup();
  const member = await app.createUser();
  await app.login(member);

  await app.switchUser(owner);
  const workspace = await app.create(Mockers.Workspace, {
    owner: { id: owner.id },
  });
  await app.create(Mockers.WorkspaceUser, {
    workspaceId: workspace.id,
    userId: member.id,
    type: WorkspaceRole.Collaborator,
  });

  const docSnapshot = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  const doc = await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: docSnapshot.id,
    title: 'private-doc',
    defaultRole: DocRole.None,
  });

  await app.switchUser(member);
  await t.throwsAsync(
    app.gql({
      query: {
        id: 'workspacePageMetaPermissionCheck',
        op: 'workspacePageMetaPermissionCheck',
        query: `
          query {
            workspace(id: "${workspace.id}") {
              pageMeta(pageId: "${doc.docId}") {
                createdAt
              }
            }
          }
        `,
      } satisfies GraphQLQuery,
      variables: undefined,
    })
  );
});

e2e('should require Doc.Read to query doc histories', async t => {
  const owner = await app.signup();
  const member = await app.createUser();
  await app.login(member);

  await app.switchUser(owner);
  const workspace = await app.create(Mockers.Workspace, {
    owner: { id: owner.id },
  });
  await app.create(Mockers.WorkspaceUser, {
    workspaceId: workspace.id,
    userId: member.id,
    type: WorkspaceRole.Collaborator,
  });

  const docSnapshot = await app.create(Mockers.DocSnapshot, {
    workspaceId: workspace.id,
    user: owner,
  });
  const doc = await app.create(Mockers.DocMeta, {
    workspaceId: workspace.id,
    docId: docSnapshot.id,
    title: 'private-doc',
    defaultRole: DocRole.None,
  });

  await app.switchUser(member);
  await t.throwsAsync(
    app.gql({
      query: {
        id: 'workspaceDocHistoriesPermissionCheck',
        op: 'workspaceDocHistoriesPermissionCheck',
        query: `
          query {
            workspace(id: "${workspace.id}") {
              histories(guid: "space:${doc.docId}") {
                timestamp
              }
            }
          }
        `,
      } satisfies GraphQLQuery,
      variables: undefined,
    })
  );
});

for (const missing of ['metadata', 'snapshot'] as const) {
  e2e(
    `missing ${missing} doc response inherits defaults and enforces canonical read`,
    async t => {
      const owner = await app.signup();
      const member = await app.createUser();
      await app.login(member);
      await app.switchUser(owner);
      const workspace = await app.create(Mockers.Workspace, { owner });
      await app.create(Mockers.WorkspaceUser, {
        workspaceId: workspace.id,
        userId: member.id,
        type: WorkspaceRole.Collaborator,
      });
      const docId = randomUUID();
      const db = app.get(PrismaClient);
      if (missing === 'metadata') {
        await app.create(Mockers.DocSnapshot, {
          workspaceId: workspace.id,
          docId,
          user: owner,
        });
      } else {
        await db.workspaceDoc.create({
          data: { workspaceId: workspace.id, docId },
        });
      }
      const query = getWorkspacePageByIdQuery;
      const request = {
        query,
        variables: { workspaceId: workspace.id, pageId: docId },
      };
      await app.switchUser(member);
      const baseline = await app.gql(request);
      t.is(baseline.workspace.doc.defaultRole, GraphQLDocRole.Reader);
      t.false(baseline.workspace.doc.public);

      await db.workspaceAccessPolicy.update({
        where: { workspaceId: workspace.id },
        data: { memberDefaultDocRole: 'commenter' },
      });
      const inherited = await app.gql(request);
      t.is(inherited.workspace.doc.defaultRole, GraphQLDocRole.Commenter);
      await db.docAccessPolicy.create({
        data: {
          workspaceId: workspace.id,
          docId,
          memberDefaultRole: 'none',
        },
      });
      const ac = app.get(PermissionAccess);
      t.false(
        await ac.user(member.id).doc(workspace.id, docId).can('Doc.Read')
      );
      await t.throwsAsync(app.gql(request));
      await app.switchUser(owner);
      const ownerDoc = await app.gql(request);
      t.is(ownerDoc.workspace.doc.defaultRole, GraphQLDocRole.None);

      // The member baseline does not alter the public policy.
      await db.docAccessPolicy.update({
        where: { workspaceId_docId: { workspaceId: workspace.id, docId } },
        data: { visibility: 'public', publicRole: 'external' },
      });
      const publicDoc = await app.gql(request);
      t.true(publicDoc.workspace.doc.public);
      t.is(publicDoc.workspace.doc.defaultRole, GraphQLDocRole.None);
    }
  );
}

e2e(
  'Reader defaults retain workspace owners and explicit document owners and managers',
  async t => {
    const owner = await app.signup();
    const docOwner = await app.createUser();
    const manager = await app.createUser();
    const reader = await app.createUser();
    const workspace = await app.create(Mockers.Workspace, { owner });
    for (const member of [docOwner, manager, reader]) {
      await app.create(Mockers.WorkspaceUser, {
        workspaceId: workspace.id,
        userId: member.id,
        type: WorkspaceRole.Collaborator,
      });
    }
    const snapshot = await app.create(Mockers.DocSnapshot, {
      workspaceId: workspace.id,
      user: docOwner,
    });
    const meta = await app.create(Mockers.DocMeta, {
      workspaceId: workspace.id,
      docId: snapshot.id,
    });
    t.is(meta.defaultRole, DocRole.Reader);
    for (const [member, type] of [
      [docOwner, DocRole.Owner],
      [manager, DocRole.Manager],
    ] as const) {
      await app.create(Mockers.DocUser, {
        workspaceId: workspace.id,
        docId: snapshot.id,
        userId: member.id,
        type,
      });
    }
    const ac = app.get(PermissionAccess);
    for (const [member, role] of [
      [owner, DocRole.Owner],
      [docOwner, DocRole.Owner],
      [manager, DocRole.Manager],
      [reader, DocRole.Reader],
    ] as const) {
      const result = await ac
        .user(member.id)
        .doc(workspace.id, snapshot.id)
        .permissions();
      t.is(result.role, role);
      t.true(result.permissions['Doc.Read']);
      t.is(result.permissions['Doc.Update'], role !== DocRole.Reader);
      t.is(result.permissions['Doc.Publish'], role !== DocRole.Reader);
      t.is(result.permissions['Doc.Users.Manage'], role !== DocRole.Reader);
      t.is(result.permissions['Doc.TransferOwner'], role === DocRole.Owner);
    }
  }
);

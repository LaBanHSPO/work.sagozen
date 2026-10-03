import { PrismaClient } from '@prisma/client';
import ava, { TestFn } from 'ava';

import { ActionForbidden } from '../../base';
import {
  Feature,
  UserFeatureModel,
  UserModel,
  WorkspaceModel,
} from '../../models';
import { Mockers } from '../mocks';
import { createTestingModule, type TestingModule } from '../utils';

interface Context {
  module: TestingModule;
  db: PrismaClient;
  user: UserModel;
  workspace: WorkspaceModel;
}

const test = ava.serial as TestFn<Context>;

test.before(async t => {
  const module = await createTestingModule();
  t.context = {
    module,
    db: module.get(PrismaClient),
    user: module.get(UserModel),
    workspace: module.get(WorkspaceModel),
  };
});

test.beforeEach(async t => {
  await t.context.module.initTestingDB();
});

test.after.always(async t => {
  await t.context.module?.close();
});

test('creates the first personal workspace and rejects another', async t => {
  const { db, user, workspace } = t.context;
  const owner = await user.create({ email: 'owner@affine.pro' });
  const first = await workspace.createPersonal(owner.id);

  t.truthy(first.id);
  t.false(first.public);
  t.deepEqual(
    await db.workspaceMember.findMany({
      where: { workspaceId: first.id },
      select: { userId: true, role: true, state: true },
    }),
    [{ userId: owner.id, role: 'owner', state: 'active' }]
  );
  await t.throwsAsync(workspace.createPersonal(owner.id), {
    instanceOf: ActionForbidden,
    message: /only create one personal workspace/,
  });
  t.is(await db.workspace.count(), 1);
});

test('concurrent personal workspace creation succeeds exactly once', async t => {
  const { db, user, workspace } = t.context;
  const owner = await user.create({ email: 'owner@affine.pro' });
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () => workspace.createPersonal(owner.id))
  );

  t.is(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.filter(result => result.status === 'rejected');
  t.is(rejected.length, 2);
  for (const result of rejected) {
    t.true(result.reason instanceof ActionForbidden);
  }
  t.is(await db.workspace.count(), 1);
  t.is(
    await db.workspaceMember.count({
      where: { userId: owner.id, role: 'owner', state: 'active' },
    }),
    1
  );
});

test('active server administrators can own multiple personal workspaces', async t => {
  const { module, user, workspace } = t.context;
  const owner = await user.create({ email: 'admin@affine.pro' });
  const features = module.get(UserFeatureModel);
  await features.add(owner.id, Feature.Admin, 'test');
  t.true(await features.has(owner.id, Feature.Admin));

  const first = await workspace.createPersonal(owner.id);
  const second = await workspace.createPersonal(owner.id);
  t.not(first.id, second.id);

  await features.remove(owner.id, Feature.Admin);
  await t.throwsAsync(workspace.createPersonal(owner.id), {
    instanceOf: ActionForbidden,
  });
});

test('joined workspaces do not consume the personal workspace allowance', async t => {
  const { module, db, user, workspace } = t.context;
  const owner = await user.create({ email: 'owner@affine.pro' });
  const member = await user.create({ email: 'member@affine.pro' });
  for (let i = 0; i < 3; i++) {
    const joined = await workspace.create(owner.id);
    await module.create(Mockers.WorkspaceUser, {
      workspaceId: joined.id,
      userId: member.id,
    });
  }

  const personal = await workspace.createPersonal(member.id);
  t.truthy(personal.id);
  t.is(await db.workspaceMember.count({ where: { userId: member.id } }), 4);
  await t.throwsAsync(workspace.createPersonal(member.id), {
    instanceOf: ActionForbidden,
  });
});

test('owned team workspaces do not consume the personal workspace allowance', async t => {
  const { module, user, workspace } = t.context;
  const owner = await user.create({ email: 'owner@affine.pro' });
  const team = await workspace.create(owner.id);
  await module.create(Mockers.TeamWorkspace, { id: team.id });
  t.true(await workspace.isTeamWorkspace(team.id));

  const personal = await workspace.createPersonal(owner.id);
  t.not(personal.id, team.id);
  await t.throwsAsync(workspace.createPersonal(owner.id), {
    instanceOf: ActionForbidden,
  });
});

test('deleting a personal workspace permits a replacement', async t => {
  const { db, user, workspace } = t.context;
  const owner = await user.create({ email: 'owner@affine.pro' });
  const first = await workspace.createPersonal(owner.id);
  await workspace.delete(first.id);

  const replacement = await workspace.createPersonal(owner.id);
  t.not(replacement.id, first.id);
  t.is(await workspace.get(first.id), null);
  t.is(await db.workspace.count(), 1);
});

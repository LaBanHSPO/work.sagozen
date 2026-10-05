import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';

import { HttpStatus } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import ava, { TestFn } from 'ava';
import Sinon from 'sinon';
import supertest from 'supertest';

import { ConfigFactory } from '../../base';
import {
  getRequestCookie,
  getRequestHeader,
  parseCookies as safeParseCookies,
} from '../../base/utils/request';
import { MagicLinkAuthService } from '../../core/auth/magic-link';
import { AuthService } from '../../core/auth/service';
import { BackendRuntimeProvider } from '../../core/backend-runtime';
import {
  createTestingApp,
  currentUser,
  parseCookies,
  TestingApp,
} from '../utils';

const test = ava.serial as TestFn<{
  auth: AuthService;
  magicLink: MagicLinkAuthService;
  runtime: BackendRuntimeProvider;
  db: PrismaClient;
  config: ConfigFactory;
  app: TestingApp;
}>;

async function lastAuthMail(app: TestingApp, name: string) {
  const delivery = await app.get(PrismaClient).mailDelivery.findFirstOrThrow({
    where: { mailName: name },
    orderBy: { createdAt: 'desc' },
  });
  return delivery.payload as { to: string; props: Record<string, string> };
}

test.before(async t => {
  const app = await createTestingApp();
  app.url();

  t.context.auth = app.get(AuthService);
  t.context.magicLink = app.get(MagicLinkAuthService);
  t.context.runtime = app.get(BackendRuntimeProvider);
  t.context.db = app.get(PrismaClient);
  t.context.config = app.get(ConfigFactory);
  t.context.app = app;
});

test.beforeEach(async t => {
  Sinon.reset();
  await t.context.app.initTestingDB();
  t.context.config.override({
    auth: { allowSignup: true, requireEmailDomainVerification: false },
    captcha: {
      enabled: false,
      config: {
        turnstile: {
          secret: '',
          siteKey: '',
          action: 'auth-sign-in',
        },
        challenge: { bits: 20 },
      },
    },
  });
  await t.context.runtime.onConfigChanged({
    updates: {
      auth: { allowSignup: true, requireEmailDomainVerification: false },
    },
  });
});

test.after.always(async t => {
  await t.context.app.close();
});

test('should be able to sign in with credential', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  const res = await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  t.is(res.body.id, u1.id);
  t.falsy(res.body.token);
  t.falsy(res.body.expiresAt);

  const session = await currentUser(app);
  t.is(session?.id, u1.id);
});

test('should validate Turnstile action and reject query credentials', async t => {
  const { app, config, runtime } = t.context;
  const user = await app.createUser('turnstile-login@affine.pro');
  config.override({
    captcha: {
      enabled: true,
      config: {
        turnstile: {
          secret: 'secret',
          siteKey: 'site-key',
          action: 'auth-sign-in',
        },
        challenge: { bits: 20 },
      },
    },
  });
  const publicConfig = await app.GET('/api/auth/captcha').expect(200);
  t.deepEqual(publicConfig.body, {
    provider: 'turnstile',
    siteKey: 'site-key',
    action: 'auth-sign-in',
  });
  const verify = Sinon.stub(runtime, 'verifyAuthCaptchaV1').resolves(true);
  await app
    .POST('/api/auth/sign-in')
    .set('x-captcha-provider', 'turnstile')
    .set('x-captcha-token', 'turnstile-token')
    .send({ email: user.email, password: user.password })
    .expect(200);
  t.true(verify.calledOnce);
  verify.restore();

  await app
    .POST('/api/auth/sign-in?provider=turnstile&token=turnstile-token')
    .send({ email: user.email, password: user.password })
    .expect(400);
});

test('should reject a Turnstile response for another action', async t => {
  const { app, config, runtime } = t.context;
  const user = await app.createUser('turnstile-action@affine.pro');
  config.override({
    captcha: {
      enabled: true,
      config: {
        turnstile: {
          secret: 'secret',
          siteKey: 'site-key',
          action: 'auth-sign-in',
        },
        challenge: { bits: 20 },
      },
    },
  });
  const verify = Sinon.stub(runtime, 'verifyAuthCaptchaV1').resolves(false);

  const response = await app
    .POST('/api/auth/sign-in')
    .set('x-captcha-provider', 'turnstile')
    .set('x-captcha-token', 'turnstile-token')
    .send({ email: user.email, password: user.password })
    .expect(400);
  verify.restore();
  t.is(response.body.name, 'CAPTCHA_VERIFICATION_FAILED');
});

test('should expose a retryable error when Turnstile is unavailable', async t => {
  const { app, config, runtime } = t.context;
  const user = await app.createUser('turnstile-unavailable@affine.pro');
  config.override({
    captcha: {
      enabled: true,
      config: {
        turnstile: {
          secret: 'secret',
          siteKey: 'site-key',
          action: 'auth-sign-in',
        },
        challenge: { bits: 20 },
      },
    },
  });
  const verify = Sinon.stub(runtime, 'verifyAuthCaptchaV1').rejects(
    new Error('captcha_provider_unavailable')
  );

  const response = await app
    .POST('/api/auth/sign-in')
    .set('x-captcha-provider', 'turnstile')
    .set('x-captcha-token', 'turnstile-token')
    .send({ email: user.email, password: user.password })
    .expect(504);
  verify.restore();
  t.is(response.body.name, 'NETWORK_ERROR');
});

test('should not cache auth session response', async t => {
  const { app } = t.context;

  const res = await app.GET('/api/auth/session').expect(200);

  t.is(res.headers['cache-control'], 'no-store');
});

test('should list historical sessions and revoke them from browser authentication', async t => {
  const { app, db } = t.context;
  const user = await app.createUser('session-history@affine.pro');
  const historical = await app.seedLegacyAuthSession(user.id, {
    installationId: 'historical-device',
    platform: 'electron',
  });
  await app
    .POST('/api/auth/sign-in')
    .send({ email: user.email, password: user.password })
    .expect(200);

  const sessions = await app.GET('/api/auth/sessions').expect(200);
  t.is(sessions.headers['cache-control'], 'no-store');
  t.is(sessions.headers.pragma, 'no-cache');
  t.is(sessions.body.length, 1);
  t.is(sessions.body[0].id, historical.session.id);
  t.false(sessions.body[0].current);

  const revoked = await app
    .DELETE(`/api/auth/sessions/${historical.session.id}`)
    .expect(200);
  t.is(revoked.headers['cache-control'], 'no-store');
  t.is(revoked.headers.pragma, 'no-cache');
  t.truthy(
    (await db.authSession.findUniqueOrThrow({
      where: { id: historical.session.id },
    })).revokedAt
  );
  await supertest(app.getHttpServer())
    .get('/api/auth/session')
    .set('Authorization', `Bearer ${historical.accessToken}`)
    .expect(401);
  t.is((await currentUser(app))?.id, user.id);
});

test('should require csrf and revoke cookie plus historical auth sessions', async t => {
  const { app, db } = t.context;
  const user = await app.createUser('cookie-revoke-all@affine.pro');
  const signedIn = await app
    .POST('/api/auth/sign-in')
    .send({ email: user.email, password: user.password })
    .expect(200);
  const cookies = signedIn.get('Set-Cookie') ?? [];
  const parsed = parseCookies(signedIn);
  await app.seedLegacyAuthSession(user.id, {
    installationId: 'cookie-managed-device',
    platform: 'electron',
  });
  app.clearAuth();

  await app
    .POST('/api/auth/sessions/revoke-all')
    .set('Cookie', cookies)
    .expect(403);
  await app
    .POST('/api/auth/sessions/revoke-all')
    .set('Cookie', cookies)
    .set('x-affine-csrf-token', parsed[AuthService.csrfCookieName])
    .expect(201);

  t.is(await db.userSession.count({ where: { userId: user.id } }), 0);
  t.is(
    await db.authSession.count({
      where: { userSession: { userId: user.id } },
    }),
    0
  );
});

test('should not issue jwt for browser-origin credential sign in', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('browser@affine.pro');

  const res = await app
    .POST('/api/auth/sign-in')
    .set('origin', 'https://app.affine.pro')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  t.is(res.body.id, u1.id);
  t.falsy(res.body.token);
  t.falsy(res.body.expiresAt);
  t.falsy(res.body.exchangeCode);
});

test('should write legacy auth cookies when signing in with credential', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  const res = await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  const cookies = parseCookies(res);

  t.truthy(cookies[AuthService.sessionCookieName]);
  t.truthy(cookies[AuthService.userCookieName]);
  t.truthy(cookies[AuthService.csrfCookieName]);
});

test('should record sign in client version when header is provided', async t => {
  const { app, db } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  await app
    .POST('/api/auth/sign-in')
    .set('x-affine-version', '0.25.1')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  const userSession1 = await db.userSession.findFirst({
    where: { userId: u1.id },
  });
  t.is(userSession1?.signInClientVersion, '0.25.1');

  // should not overwrite existing value with null/undefined
  await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  const userSession2 = await db.userSession.findFirst({
    where: { userId: u1.id },
  });
  t.is(userSession2?.signInClientVersion, '0.25.1');
});

test('should return method-oriented preflight for registered password users', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  const res = await app
    .POST('/api/auth/preflight')
    .send({ email: u1.email })
    .expect(201);

  t.true(res.body.registered);
  t.deepEqual(res.body.methods.password, { available: true });
  t.deepEqual(res.body.methods.magicLink, { available: true });
  t.deepEqual(res.body.methods.passkey, {
    available: false,
    discoverable: false,
  });
  t.false('hasPassword' in res.body);
});

test('should return method-oriented preflight for unknown users', async t => {
  const { app } = t.context;

  const res = await app
    .POST('/api/auth/preflight')
    .send({ email: 'unknown@affine.pro' })
    .expect(201);

  t.false(res.body.registered);
  t.deepEqual(res.body.methods.password, { available: false });
  t.deepEqual(res.body.methods.magicLink, { available: true });
  t.deepEqual(res.body.methods.passkey, {
    available: false,
    discoverable: false,
  });
  t.false('hasPassword' in res.body);
});

test('should return password unavailable for registered users without password', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('passwordless@affine.pro', {
    password: null,
  });

  const res = await app
    .POST('/api/auth/preflight')
    .send({ email: u1.email })
    .expect(201);

  t.true(res.body.registered);
  t.deepEqual(res.body.methods.password, { available: false });
  t.false('hasPassword' in res.body);
});

test('should return methods unavailable for disabled users', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('disabled@affine.pro', {
    disabled: true,
  });

  const res = await app
    .POST('/api/auth/preflight')
    .send({ email: u1.email })
    .expect(201);

  t.false(res.body.registered);
  t.deepEqual(res.body.methods.password, { available: false });
  t.deepEqual(res.body.methods.magicLink, { available: false });
});

test('should return magic link unavailable for unknown users when signup is disabled', async t => {
  const { app, runtime } = t.context;

  await runtime.saveAppConfig(null, [
    {
      key: 'auth.allowSignup',
      owner: 'native',
      operation: 'set',
      valueJson: 'false',
    },
  ]);
  await runtime.onConfigChanged({
    updates: { auth: { allowSignup: false } },
  });

  const res = await app
    .POST('/api/auth/preflight')
    .send({ email: 'unknown@affine.pro' })
    .expect(201);

  t.false(res.body.registered);
  t.deepEqual(res.body.methods.magicLink, { available: false });
});

test('should return magic link unavailable when domain verification rejects signup email', async t => {
  const { app, runtime } = t.context;

  await runtime.saveAppConfig(null, [
    {
      key: 'auth.requireEmailDomainVerification',
      owner: 'native',
      operation: 'set',
      valueJson: 'true',
    },
  ]);
  await runtime.onConfigChanged({
    updates: { auth: { requireEmailDomainVerification: true } },
  });

  const res = await app
    .POST('/api/auth/preflight')
    .send({ email: 'unknown+alias@affine.pro' })
    .expect(201);

  t.false(res.body.registered);
  t.deepEqual(res.body.methods.magicLink, { available: false });
});

test('should return bound auth methods for current account', async t => {
  const { app } = t.context;

  await app.signupV1('bound-methods@affine.pro');

  const res = await app.GET('/api/auth/methods').expect(200);

  t.deepEqual(res.body.password, { bound: true });
  t.deepEqual(res.body.oauth, { bound: false, providers: [] });
  t.deepEqual(res.body.passkey, { bound: false, count: 0 });
});

test('should be able to sign in with email', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  const res = await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email })
    .expect(200);

  t.is(res.body.email, u1.email);
  const signInMail = await lastAuthMail(app, 'SignIn');

  t.is(signInMail.to, u1.email);

  const url = new URL(signInMail.props.url);
  const email = url.searchParams.get('email');
  const token = url.searchParams.get('token');

  const signInRes = await app
    .POST('/api/auth/magic-link')
    .send({ email, token })
    .expect(201);

  t.is(signInRes.body.id, u1.id);
  t.falsy(signInRes.body.token);
  t.falsy(signInRes.body.expiresAt);

  const cookies = parseCookies(signInRes);
  t.truthy(cookies[AuthService.sessionCookieName]);
  t.truthy(cookies[AuthService.userCookieName]);
  t.truthy(cookies[AuthService.csrfCookieName]);

  const session = await currentUser(app);
  t.is(session?.id, u1.id);
});

test('should be able to sign up with email', async t => {
  const { app } = t.context;

  const res = await app
    .POST('/api/auth/sign-in')
    .send({ email: 'u2@affine.pro' })
    .expect(200);

  t.is(res.body.email, 'u2@affine.pro');
  const signUpMail = await lastAuthMail(app, 'SignUp');

  t.is(signUpMail.to, 'u2@affine.pro');

  const url = new URL(signUpMail.props.url);
  const email = url.searchParams.get('email');
  const token = url.searchParams.get('token');

  await app.POST('/api/auth/magic-link').send({ email, token }).expect(201);

  const session = await currentUser(app);
  t.is(session?.email, 'u2@affine.pro');
});

test('should not be able to sign in if email is invalid', async t => {
  const { app } = t.context;

  const res = await app
    .POST('/api/auth/sign-in')
    .send({ email: '' })
    .expect(400);

  t.is(res.body.message, 'An invalid email provided: ');
});

test('should not create magic-link state if email is invalid', async t => {
  const { app, magicLink } = t.context;

  await t.throwsAsync(magicLink.send('invalid-email'), {
    message: 'An invalid email provided: invalid-email',
  });

  t.is(app.mails.count('SignIn'), 0);
  t.is(app.mails.count('SignUp'), 0);
});

test('should not be able to sign in if forbidden', async t => {
  const { app, auth } = t.context;

  const u1 = await app.createUser('u1@affine.pro');
  const canSignInStub = Sinon.stub(auth, 'canSignIn').resolves(false);

  await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email })
    .expect(HttpStatus.FORBIDDEN);

  canSignInStub.restore();
  t.pass();
});

test('should forbid magic link with external callbackUrl', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  await app
    .POST('/api/auth/sign-in')
    .send({
      email: u1.email,
      callbackUrl: 'https://evil.example/magic-link',
    })
    .expect(HttpStatus.FORBIDDEN);
  t.pass();
});

test('should forbid magic link with untrusted redirect_uri in callbackUrl', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  await app
    .POST('/api/auth/sign-in')
    .send({
      email: u1.email,
      callbackUrl: '/magic-link?redirect_uri=https://evil.example',
    })
    .expect(HttpStatus.FORBIDDEN);
  t.pass();
});

test('should be able to sign out', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  await app.POST('/api/auth/sign-out').expect(200);

  const session = await currentUser(app);

  t.falsy(session);
});

test('should reject cookie sign out when csrf header is missing', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  const signInRes = await supertest(app.getHttpServer())
    .post('/api/auth/sign-in')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  const cookies = parseCookies(signInRes);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  await supertest(app.getHttpServer())
    .post('/api/auth/sign-out')
    .set('Cookie', cookieHeader)
    .expect(HttpStatus.FORBIDDEN);

  const sessionRes = await supertest(app.getHttpServer())
    .get('/api/auth/session')
    .set('Cookie', cookieHeader)
    .expect(200);

  t.is(sessionRes.body.user.id, u1.id);
});

test('should revoke a historical bearer session on sign out without csrf', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  const { accessToken: token } = await app.seedLegacyAuthSession(u1.id);

  await supertest(app.getHttpServer())
    .post('/api/auth/sign-out')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const sessionRes = await supertest(app.getHttpServer())
    .get('/api/auth/session')
    .set('Authorization', `Bearer ${token}`)
    .expect(401);
  t.is(sessionRes.body.code, 'AUTH_SESSION_REVOKED');
});

test('should ignore user_id query when signing out with jwt', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');
  const u2 = await app.createUser('u2@affine.pro');

  const { accessToken: u1Token } = await app.seedLegacyAuthSession(u1.id);
  await app
    .POST('/api/auth/sign-in')
    .send({ email: u2.email, password: u2.password })
    .expect(200);

  await supertest(app.getHttpServer())
    .post(`/api/auth/sign-out?user_id=${u2.id}`)
    .set('Authorization', `Bearer ${u1Token}`)
    .expect(200);

  const u1Session = await supertest(app.getHttpServer())
    .get('/api/auth/session')
    .set('Authorization', `Bearer ${u1Token}`)
    .expect(401);
  t.is(u1Session.body.code, 'AUTH_SESSION_REVOKED');

  const cookieSession = await app.GET('/api/auth/session').expect(200);
  t.is(cookieSession.body.user.id, u2.id);
});

test('should isolate cookie sessions from a historical bearer account', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');
  const u2 = await app.createUser('u2@affine.pro');

  const { accessToken: u1Token } = await app.seedLegacyAuthSession(u1.id);

  const u2SignIn = await supertest(app.getHttpServer())
    .post('/api/auth/sign-in')
    .set('Authorization', `Bearer ${u1Token}`)
    .send({ email: u2.email, password: u2.password })
    .expect(200);

  const u1Session = await t.context.db.userSession.findFirstOrThrow({
    where: { userId: u1.id },
  });
  const u2Session = await t.context.db.userSession.findFirstOrThrow({
    where: { userId: u2.id },
  });

  t.is(u2SignIn.body.id, u2.id);
  t.not(u2Session.sessionId, u1Session.sessionId);
});

test('should not reuse legacy bearer session id when signing in another account without cookies', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');
  const u2 = await app.createUser('u2@affine.pro');

  await supertest(app.getHttpServer())
    .post('/api/auth/sign-in')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  const u1Session = await t.context.db.userSession.findFirstOrThrow({
    where: { userId: u1.id },
  });

  await supertest(app.getHttpServer())
    .post('/api/auth/sign-in')
    .set('Authorization', `Bearer ${u1Session.sessionId}`)
    .send({ email: u2.email, password: u2.password })
    .expect(200);

  const u2Session = await t.context.db.userSession.findFirstOrThrow({
    where: { userId: u2.id },
  });

  t.not(u2Session.sessionId, u1Session.sessionId);
});

test('should be able to sign out when duplicated csrf cookies exist', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  const signInRes = await supertest(app.getHttpServer())
    .post('/api/auth/sign-in')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  const cookies = parseCookies(signInRes);
  const csrf = cookies[AuthService.csrfCookieName];

  const cookieHeader = [
    `${AuthService.sessionCookieName}=${cookies[AuthService.sessionCookieName]}`,
    `${AuthService.userCookieName}=${cookies[AuthService.userCookieName]}`,
    `${AuthService.csrfCookieName}=${csrf}`,
    `${AuthService.csrfCookieName}=${randomUUID()}`,
  ].join('; ');

  await supertest(app.getHttpServer())
    .post('/api/auth/sign-out')
    .set('Cookie', cookieHeader)
    .set('x-affine-csrf-token', csrf)
    .expect(200);

  const sessionRes = await supertest(app.getHttpServer())
    .get('/api/auth/session')
    .set('Cookie', cookieHeader)
    .expect(200);

  t.falsy(sessionRes.body.user);
});

test('should reject sign out when csrf token mismatched', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  await app
    .POST('/api/auth/sign-out')
    .set('x-affine-csrf-token', 'invalid')
    .expect(HttpStatus.FORBIDDEN);

  const session = await currentUser(app);
  t.is(session?.id, u1.id);
});

test('should be able to correct user id cookie', async t => {
  const { app } = t.context;

  const u1 = await app.signupV1('u1@affine.pro');

  const req = app.GET('/api/auth/session');
  let cookies = req.get('cookie') as unknown as string[];
  cookies = cookies.filter(c => !c.startsWith(AuthService.userCookieName));
  cookies.push(`${AuthService.userCookieName}=invalid_user_id`);
  const res = await req.set('Cookie', cookies).expect(200);
  const setCookies = parseCookies(res);
  const userIdCookie = setCookies[AuthService.userCookieName];

  t.is(userIdCookie, u1.id);
});

test('should not throw on parse of a bad cookie', async t => {
  const badCookieKey = 'auth_session';
  const badCookieVal = '^13l3PK9qJs*J%X$MOOOIguhkqWvVh7*';

  const req = {
    headers: { cookie: `${badCookieKey}=${badCookieVal}` },
  } as IncomingMessage & { cookies?: Record<string, string> };

  t.notThrows(() => safeParseCookies(req));

  t.is(req.cookies?.[badCookieKey], badCookieVal);
});

test('should only read string request cookies', t => {
  const req = {
    headers: {},
    cookies: {
      empty: '',
      list: ['session'],
      object: { value: 'session' },
      session: 'valid_session',
    },
  } as unknown as IncomingMessage & { cookies?: Record<string, unknown> };

  t.is(getRequestCookie(req, 'session'), 'valid_session');
  t.is(getRequestCookie(req, 'empty'), undefined);
  t.is(getRequestCookie(req, 'list'), undefined);
  t.is(getRequestCookie(req, 'object'), undefined);
});

test('should only read string request headers', t => {
  const req = {
    headers: {
      'x-list': ['value'],
      'x-string': 'value',
    },
  } as unknown as IncomingMessage;

  t.is(getRequestHeader(req, 'x-string'), 'value');
  t.is(getRequestHeader(req, 'x-list'), undefined);
});

// multiple accounts session tests
test('should be able to sign in another account in one session', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');
  const u2 = await app.createUser('u2@affine.pro');

  // sign in u1
  const res = await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email, password: u1.password })
    .expect(200);

  const cookies = parseCookies(res);

  // sign in u2 in the same session
  await app
    .POST('/api/auth/sign-in')
    .send({ email: u2.email, password: u2.password })
    .expect(200);

  // default to latest signed in user: u2
  let session = await app.GET('/api/auth/session').expect(200);

  t.is(session.body.user.id, u2.id);

  // switch to u1
  session = await app
    .GET('/api/auth/session')
    .set(
      'Cookie',
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    )
    .expect(200);

  t.is(session.body.user.id, u1.id);
});

test('should be able to sign out multiple accounts in one session', async t => {
  const { app } = t.context;

  const u1 = await app.signupV1('u1@affine.pro');
  const u2 = await app.signupV1('u2@affine.pro');

  // sign out u2
  await app.POST(`/api/auth/sign-out?user_id=${u2.id}`).expect(200);

  // list [u1]
  let session = await app.GET('/api/auth/session').expect(200);
  t.is(session.body.user.id, u1.id);

  // sign in u2 in the same session
  await app
    .POST('/api/auth/sign-in')
    .send({ email: u2.email, password: u2.password })
    .expect(200);

  // sign out all account in session
  await app.POST('/api/auth/sign-out').expect(200);

  session = await app.GET('/api/auth/session').expect(200);
  t.falsy(session.body.user);
});

test('should be able to sign in with email and client nonce', async t => {
  const { app } = t.context;

  const clientNonce = randomUUID();
  const u1 = await app.createUser();

  const res = await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email, client_nonce: clientNonce })
    .expect(200);

  t.is(res.body.email, u1.email);
  const signInMail = await lastAuthMail(app, 'SignIn');

  t.is(signInMail.to, u1.email);

  const url = new URL(signInMail.props.url);
  const email = url.searchParams.get('email');
  const token = url.searchParams.get('token');

  await app
    .POST('/api/auth/magic-link')
    .send({ email, token, client_nonce: clientNonce })
    .expect(201);

  const session = await currentUser(app);
  t.is(session?.id, u1.id);
});

test('should not be able to sign in with email and client nonce if invalid', async t => {
  const { app } = t.context;

  const clientNonce = randomUUID();
  const u1 = await app.createUser();

  const res = await app
    .POST('/api/auth/sign-in')
    .send({ email: u1.email, client_nonce: clientNonce })
    .expect(200);

  t.is(res.body.email, u1.email);
  const signInMail = await lastAuthMail(app, 'SignIn');

  t.is(signInMail.to, u1.email);

  const url = new URL(signInMail.props.url);
  const email = url.searchParams.get('email');
  const token = url.searchParams.get('token');

  // invalid client nonce
  await app
    .POST('/api/auth/magic-link')
    .send({ email, token, client_nonce: randomUUID() })
    .expect(400)
    .expect({
      status: 400,
      code: 'Bad Request',
      type: 'BAD_REQUEST',
      name: 'INVALID_AUTH_STATE',
      message:
        'Invalid auth state. You might start the auth progress from another device.',
    });
  // no client nonce
  await app
    .POST('/api/auth/magic-link')
    .send({ email, token })
    .expect(400)
    .expect({
      status: 400,
      code: 'Bad Request',
      type: 'BAD_REQUEST',
      name: 'INVALID_AUTH_STATE',
      message:
        'Invalid auth state. You might start the auth progress from another device.',
    });

  const session = await currentUser(app);
  t.falsy(session);
});

test('should not be able to sign in if token is invalid', async t => {
  const { app } = t.context;

  const res = await app
    .POST('/api/auth/magic-link')
    .send({ email: 'u1@affine.pro', token: 'invalid' })
    .expect(400);

  t.is(res.body.message, 'An invalid email token provided.');
});

test('should not allow magic link OTP replay', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  await app.POST('/api/auth/sign-in').send({ email: u1.email }).expect(200);
  const signInMail = await lastAuthMail(app, 'SignIn');
  const url = new URL(signInMail.props.url);
  const email = url.searchParams.get('email');
  const token = url.searchParams.get('token');

  await app.POST('/api/auth/magic-link').send({ email, token }).expect(201);

  await app
    .POST('/api/auth/magic-link')
    .send({ email, token })
    .expect(400)
    .expect({
      status: 400,
      code: 'Bad Request',
      type: 'INVALID_INPUT',
      name: 'INVALID_EMAIL_TOKEN',
      message: 'An invalid email token provided.',
    });
  t.pass();
});

test('should lock magic link OTP after too many attempts', async t => {
  const { app } = t.context;

  const u1 = await app.createUser('u1@affine.pro');

  await app.POST('/api/auth/sign-in').send({ email: u1.email }).expect(200);
  const signInMail = await lastAuthMail(app, 'SignIn');
  const url = new URL(signInMail.props.url);
  const email = url.searchParams.get('email');
  const token = url.searchParams.get('token') as string;

  const wrongOtp = token === '000000' ? '000001' : '000000';

  for (let i = 0; i < 10; i++) {
    await app
      .POST('/api/auth/magic-link')
      .send({ email, token: wrongOtp })
      .expect(400);
  }

  await app.POST('/api/auth/magic-link').send({ email, token }).expect(400);

  const session = await currentUser(app);
  t.falsy(session);
});

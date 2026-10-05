/**
 * @vitest-environment happy-dom
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const services = vi.hoisted(() => {
  const config = { type: 'Affine', serverName: 'AFFiNE Cloud' };
  const server = {
    scope: {},
    config$: {
      selector: (select: (value: typeof config) => unknown) => select(config),
    },
  };
  return {
    server,
    auth: {
      session: { status$: 'unauthenticated' },
      checkUserByEmail: vi.fn(),
      signInPassword: vi.fn(),
    },
    captcha: { needCaptcha$: false, revalidate: vi.fn() },
  };
});

vi.mock('@affine/core/modules/cloud', () => ({
  DefaultServerService: class DefaultServerService {},
  AuthService: class AuthService {},
  ServerService: class ServerService {},
  CaptchaService: class CaptchaService {},
  getSelfHostedServerName: () => 'AFFiNE Self-hosted',
}));
vi.mock('@toeverything/infra', () => ({
  FrameworkScope: ({ children }: PropsWithChildren) => children,
  useLiveData: (value: unknown) => value,
  useService: (service: { name: string }) => {
    if (service.name === 'AuthService') return services.auth;
    if (service.name === 'CaptchaService') return services.captcha;
    return { server: services.server };
  },
}));
vi.mock('@affine/component', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
  Button: ({
    children,
    disabled,
  }: PropsWithChildren<{ disabled?: boolean }>) => (
    <button disabled={disabled}>{children}</button>
  ),
}));
vi.mock('@affine/component/ui/button', async () => {
  const { Button } = await import('@affine/component');
  return { Button };
});
vi.mock('@affine/component/auth-components', () => ({
  AuthContainer: ({ children }: PropsWithChildren) => <div>{children}</div>,
  AuthContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  AuthFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  AuthHeader: ({ subTitle }: { subTitle: string }) => <h1>{subTitle}</h1>,
  BackButton: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick}>Back</button>
  ),
  AuthInput: ({
    label,
    onChange,
    ...props
  }: {
    label: string;
    onChange?: (value: string) => void;
    type?: string;
    value?: string;
    readOnly?: boolean;
    name?: string;
    autoComplete?: string;
  }) => (
    <input
      aria-label={label}
      {...props}
      onChange={event => onChange?.(event.target.value)}
    />
  ),
}));
vi.mock('@affine/i18n', () => {
  const t = new Proxy({}, { get: (_, key) => () => String(key) });
  return { useI18n: () => t };
});
vi.mock('../hooks/affine/use-selfhost-login-version-guard', () => ({
  useSelfhostLoginVersionGuard: () => null,
}));
vi.mock('./captcha', () => ({ Captcha: () => <div>Captcha</div> }));

import { SELF_HOSTED_SERVER_URL } from '../../modules/cloud/self-hosted-sign-in';
import { SignInPanel } from '.';

describe('web self-hosted sign-in', () => {
  beforeEach(() => {
    vi.stubGlobal('location', {
      origin: SELF_HOSTED_SERVER_URL,
      replace: vi.fn(),
    });
    services.auth.checkUserByEmail.mockResolvedValue({
      methods: {
        password: { available: false },
        magicLink: { available: true },
      },
    });
    services.auth.signInPassword.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('opens the fixed server email form', () => {
    render(<SignInPanel />);
    expect(screen.getByRole('heading').textContent).toBe(
      SELF_HOSTED_SERVER_URL
    );
    expect(screen.queryByText('Server picker')).toBeNull();
    expect(screen.queryByText('OAuth')).toBeNull();
    expect(
      screen.queryByText('com.affine.mobile.sign-in.skip.link')
    ).toBeNull();
    expect(screen.queryByText('Back')).toBeNull();
  });

  test('uses password sign-in even when the preflight advertises an email code', async () => {
    render(<SignInPanel />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    const password = await screen.findByLabelText('com.affine.auth.password');
    expect(screen.queryByText('Email code')).toBeNull();
    expect(
      screen.queryByText('com.affine.auth.sign.auth.code.send-email.sign-in')
    ).toBeNull();
    fireEvent.change(password, { target: { value: 'password' } });
    fireEvent.submit(password.closest('form')!);
    await waitFor(() =>
      expect(services.auth.signInPassword).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'password',
        verifyToken: undefined,
        challenge: undefined,
      })
    );
  });

  test('redirects to the fixed origin before rendering a login form', () => {
    vi.stubGlobal('location', {
      origin: 'https://other.example',
      replace: vi.fn(),
    });
    render(<SignInPanel redirectUrl="/workspace?tab=docs" />);
    const target = new URL(vi.mocked(location.replace).mock.calls[0][0]);
    expect(target.origin).toBe(SELF_HOSTED_SERVER_URL);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('redirect_uri')).toBe('/workspace?tab=docs');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('also simplifies the mobile browser login', () => {
    vi.stubGlobal('environment', { ...environment, isMobile: true });
    render(<SignInPanel />);
    expect(screen.getByRole('heading').textContent).toBe(
      SELF_HOSTED_SERVER_URL
    );
    expect(screen.queryByText('Server picker')).toBeNull();
    expect(screen.queryByText('OAuth')).toBeNull();
  });

});

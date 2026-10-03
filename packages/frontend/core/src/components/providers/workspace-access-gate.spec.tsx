// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  session: { status$: 'authenticated' },
  server: { baseUrl: 'https://workspace.example.com' },
  jumpToSignIn: vi.fn(),
}));

vi.mock('@affine/core/modules/cloud', () => ({
  AuthService: class AuthService {},
  ServerService: class ServerService {},
}));
vi.mock('@toeverything/infra', () => ({
  useService: () => auth,
  useLiveData: (value: unknown) => value,
}));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/workspace/cloud-id/all',
    search: '?server=example',
    hash: '#doc',
  }),
}));
vi.mock('../hooks/use-navigate-helper', () => ({
  RouteLogic: { REPLACE: 'replace' },
  useNavigateHelper: () => ({ jumpToSignIn: auth.jumpToSignIn }),
}));

import { WorkspaceAccessGate } from './workspace-access-gate';

describe('workspace access', () => {
  beforeEach(() => {
    auth.session.status$ = 'authenticated';
    auth.jumpToSignIn.mockClear();
  });
  afterEach(cleanup);

  it('does not mount workspace effects for a signed-out visitor', () => {
    auth.session.status$ = 'unauthenticated';
    const startEngine = vi.fn();
    const Workspace = () => {
      useEffect(startEngine, []);
      return <div>Private workspace</div>;
    };
    const view = render(
      <WorkspaceAccessGate>
        <Workspace />
      </WorkspaceAccessGate>
    );
    expect(startEngine).not.toHaveBeenCalled();
    expect(view.queryByText('Private workspace')).toBeNull();
    expect(auth.jumpToSignIn).toHaveBeenCalledWith(
      '/workspace/cloud-id/all?server=example#doc',
      'replace',
      undefined,
      {
        server: 'https://workspace.example.com',
      }
    );
  });

  it('unmounts workspace content and disconnects effects on sign-out', () => {
    const stopEngine = vi.fn();
    const Workspace = () => {
      useEffect(() => stopEngine, []);
      return <div>Private workspace</div>;
    };
    const view = render(
      <WorkspaceAccessGate>
        <Workspace />
      </WorkspaceAccessGate>
    );
    expect(view.getByText('Private workspace')).toBeTruthy();
    expect(auth.jumpToSignIn).not.toHaveBeenCalled();
    auth.session.status$ = 'unauthenticated';
    view.rerender(
      <WorkspaceAccessGate>
        <Workspace />
      </WorkspaceAccessGate>
    );
    expect(view.queryByText('Private workspace')).toBeNull();
    expect(stopEngine).toHaveBeenCalledOnce();
    expect(auth.jumpToSignIn).toHaveBeenCalledOnce();
  });
});

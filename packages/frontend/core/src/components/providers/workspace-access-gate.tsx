import { AuthService, ServerService } from '@affine/core/modules/cloud';
import { useLiveData, useService } from '@toeverything/infra';
import { type PropsWithChildren, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { RouteLogic, useNavigateHelper } from '../hooks/use-navigate-helper';

/** Mount workspace content only while signed in to its server. */
export const WorkspaceAccessGate = ({ children }: PropsWithChildren) => {
  const session = useService(AuthService).session;
  const server = useService(ServerService).server;
  const location = useLocation();
  const redirectUri = location.pathname + location.search + location.hash;
  const status = useLiveData(session.status$);
  const { jumpToSignIn } = useNavigateHelper();

  useEffect(() => {
    if (status !== 'authenticated') {
      jumpToSignIn(redirectUri, RouteLogic.REPLACE, undefined, {
        server: server.baseUrl,
      });
    }
  }, [jumpToSignIn, redirectUri, server.baseUrl, status]);

  return status === 'authenticated' ? children : null;
};

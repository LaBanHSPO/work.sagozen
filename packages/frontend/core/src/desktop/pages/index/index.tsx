import { DefaultServerService } from '@affine/core/modules/cloud';
import { DesktopApiService } from '@affine/core/modules/desktop-api';
import { WorkspacesService } from '@affine/core/modules/workspace';
import { buildShowcaseWorkspace } from '@affine/core/utils/first-app-data';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@toeverything/infra';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  RouteLogic,
  useNavigateHelper,
} from '../../../components/hooks/use-navigate-helper';
import { WorkspaceNavigator } from '../../../components/workspace-selector';
import { AuthService } from '../../../modules/cloud';
import { AppContainer } from '../../components/app-container';

/**
 * index page
 *
 * query string:
 * - initCloud: boolean, if true, when user is logged in, create a cloud workspace
 */
export const Component = ({
  defaultIndexRoute = 'all',
  children,
  fallback,
}: {
  defaultIndexRoute?: string;
  children?: ReactNode;
  fallback?: ReactNode;
  createErrorFallback?: (retry: () => void) => ReactNode;
}) => {
  // Navigating may be slow, so show the workspace fallback until ready.
  const [navigating, setNavigating] = useState(true);
  const authService = useService(AuthService);
  const defaultServerService = useService(DefaultServerService);
  const loggedIn = useLiveData(
    authService.session.status$.map(s => s === 'authenticated')
  );

  const workspacesService = useService(WorkspacesService);
  const list = useLiveData(workspacesService.list.workspaces$);
  const listIsLoading = useLiveData(workspacesService.list.isRevalidating$);

  const { openPage, jumpToPage, jumpToSignIn } = useNavigateHelper();
  const [searchParams] = useSearchParams();

  const createOnceRef = useRef(false);

  const createCloudWorkspace = useCallback(() => {
    if (createOnceRef.current) return;
    createOnceRef.current = true;
    buildShowcaseWorkspace(
      workspacesService,
      defaultServerService.server.id,
      'My Workspace'
    )
      .then(({ meta, defaultDocId }) => {
        if (defaultDocId) {
          jumpToPage(meta.id, defaultDocId);
        } else {
          openPage(meta.id, defaultIndexRoute);
        }
      })
      .catch(err => {
        console.error('Failed to create cloud workspace', err);
        createOnceRef.current = false;
        setNavigating(false);
      });
  }, [
    defaultIndexRoute,
    defaultServerService,
    jumpToPage,
    openPage,
    workspacesService,
  ]);

  useLayoutEffect(() => {
    if (!loggedIn) {
      localStorage.removeItem('last_workspace_id');
      jumpToSignIn();
      return;
    }

    if (!navigating) return;

    if (listIsLoading) return;

    // check is user logged in && has cloud workspace
    if (searchParams.get('initCloud') === 'true') {
      if (loggedIn) {
        if (list.length === 0) {
          createCloudWorkspace();
          return;
        }

        // open first cloud workspace
        const openWorkspace = list[0];
        openPage(openWorkspace.id, defaultIndexRoute);
      } else {
        return;
      }
    } else {
      if (list.length === 0) {
        setNavigating(false);
        return;
      }
      // open last workspace
      const lastId = localStorage.getItem('last_workspace_id');

      const openWorkspace = list.find(w => w.id === lastId) ?? list[0];
      openPage(openWorkspace.id, defaultIndexRoute, RouteLogic.REPLACE);
    }
  }, [
    createCloudWorkspace,
    list,
    openPage,
    searchParams,
    jumpToSignIn,
    listIsLoading,
    loggedIn,
    navigating,
    defaultIndexRoute,
  ]);

  const desktopApi = useServiceOptional(DesktopApiService);

  useEffect(() => {
    desktopApi?.handler.ui.pingAppLayoutReady().catch(console.error);
  }, [desktopApi]);

  if (navigating || !loggedIn) {
    return fallback ?? <AppContainer fallback />;
  }

  // TODO(@eyhn): We need a no workspace page
  return (
    children ?? (
      <div
        style={{
          position: 'fixed',
          left: 'calc(50% - 150px)',
          top: '50%',
        }}
      >
        <p>Create a cloud workspace or open an invitation to join one.</p>
        <WorkspaceNavigator
          open={true}
          menuContentOptions={{
            forceMount: true,
          }}
        />
      </div>
    )
  );
};

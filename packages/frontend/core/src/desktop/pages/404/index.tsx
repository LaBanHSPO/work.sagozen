import {
  NoPermissionOrNotFound,
  NotFoundPage,
} from '@affine/component/not-found-page';
import { useSignOut } from '@affine/core/components/hooks/affine/use-sign-out';
import {
  FrameworkScope,
  useLiveData,
  useService,
} from '@toeverything/infra';
import type { ReactElement } from 'react';
import { useCallback } from 'react';

import {
  RouteLogic,
  useNavigateHelper,
} from '../../../components/hooks/use-navigate-helper';
import { ServersService } from '../../../modules/cloud';
import { SignIn } from '../auth/sign-in';

export const PageNotFound = ({
  noPermission,
}: {
  noPermission?: boolean;
}): ReactElement => {
  const serversService = useService(ServersService);
  const serversWithAccount = useLiveData(serversService.serversWithAccount$);

  // Check all servers for any logged in accounts to avoid showing sign-in page if user has an active session on any server
  const firstLogged = serversWithAccount.find(
    ({ account }) => account !== null
  );
  const { jumpToIndex } = useNavigateHelper();
  const openSignOutModal = useSignOut();

  const handleBackButtonClick = useCallback(
    () => jumpToIndex(RouteLogic.REPLACE),
    [jumpToIndex]
  );

  // not using workbench location or router location deliberately
  // strip the origin
  const currentUrl = window.location.href.replace(window.location.origin, '');

  return (
    <FrameworkScope scope={firstLogged?.server.scope}>
      {noPermission ? (
        <NoPermissionOrNotFound
          user={firstLogged?.account}
          onBack={handleBackButtonClick}
          onSignOut={openSignOutModal}
          signInComponent={<SignIn redirectUrl={currentUrl} />}
        />
      ) : (
        <NotFoundPage
          user={firstLogged?.account}
          onBack={handleBackButtonClick}
          onSignOut={openSignOutModal}
        />
      )}
    </FrameworkScope>
  );
};

export const Component = () => {
  return <PageNotFound />;
};

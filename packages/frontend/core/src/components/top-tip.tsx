import { BrowserWarning, LocalDemoTips } from '@affine/component/affine-banner';
import { Trans, useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useState } from 'react';

import { useEnableCloud } from '../components/hooks/affine/use-enable-cloud';
import { AuthService } from '../modules/cloud';
import { GlobalDialogService } from '../modules/dialogs';
import type { Workspace } from '../modules/workspace';

const minimumChromeVersion = 106;

const shouldShowWarning = (() => {
  if (environment.isChrome && environment.chromeVersion) {
    return environment.chromeVersion < minimumChromeVersion;
  }
  return false;
})();

const OSWarningMessage = () => {
  const t = useI18n();
  const notChrome = !environment.isChrome;
  const notGoodVersion =
    environment.isChrome &&
    environment.chromeVersion &&
    environment.chromeVersion < minimumChromeVersion;


  if (notChrome) {
    return (
      <span>
        <Trans i18nKey="recommendBrowser">
          We recommend the <strong>Chrome</strong> browser for an optimal
          experience.
        </Trans>
      </span>
    );
  } else if (notGoodVersion) {
    return <span>{t['upgradeBrowser']()}</span>;
  }

  return null;
};

export const TopTip = ({
  pageId,
  workspace,
}: {
  pageId?: string;
  workspace: Workspace;
}) => {
  const loginStatus = useLiveData(useService(AuthService).session.status$);
  const isLoggedIn = loginStatus === 'authenticated';

  const [showWarning, setShowWarning] = useState(shouldShowWarning);
  const [showLocalDemoTips, setShowLocalDemoTips] = useState(true);
  const confirmEnableCloud = useEnableCloud();

  const globalDialogService = useService(GlobalDialogService);
  const onLogin = useCallback(() => {
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  if (showLocalDemoTips && workspace.flavour === 'local') {
    return (
      <LocalDemoTips
        isLoggedIn={isLoggedIn}
        onLogin={onLogin}
        onEnableCloud={() =>
          confirmEnableCloud(workspace, { openPageId: pageId })
        }
        onClose={() => {
          setShowLocalDemoTips(false);
        }}
      />
    );
  }

  return (
    <BrowserWarning
      show={showWarning}
      message={<OSWarningMessage />}
      onClose={() => {
        setShowWarning(false);
      }}
    />
  );
};

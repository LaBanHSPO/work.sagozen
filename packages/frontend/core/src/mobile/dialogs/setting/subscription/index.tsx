import { AuthService, ServerService } from '@affine/core/modules/cloud';
import { GlobalDialogService } from '@affine/core/modules/dialogs';
import { NativePaywallService } from '@affine/core/modules/paywall';
import { useI18n } from '@affine/i18n';
import { DiamondIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback } from 'react';

import { SettingGroup } from '../group';
import { RowLayout } from '../row.layout';
import * as styles from './styles.css';

export const PlansGroup = () => {
  const serverService = useService(ServerService);
  const authService = useService(AuthService);
  const globalDialogService = useService(GlobalDialogService);
  const nativePaywallProvider =
    useService(NativePaywallService).getNativePaywallProvider();
  const t = useI18n();

  const supported = useLiveData(
    serverService.server.features$.map(f => f.payment)
  );
  const loggedIn = useLiveData(authService.session.status$) === 'authenticated';

  const handleOpen = useCallback(() => {
    if (!loggedIn) {
      globalDialogService.open('sign-in', {});
      return;
    }

    void nativePaywallProvider?.showPaywall('Pro').catch(console.error);
  }, [globalDialogService, loggedIn, nativePaywallProvider]);

  return (
    <SettingGroup title={t['com.affine.mobile.setting.plans.title']()}>
      {nativePaywallProvider && supported !== false ? (
        <RowLayout
          className={styles.planRow}
          emphasized
          prefix={<DiamondIcon />}
          label={t['com.affine.mobile.setting.subscription.title']()}
          description={t[
            'com.affine.mobile.setting.subscription.description'
          ]()}
          onClick={handleOpen}
        />
      ) : null}
    </SettingGroup>
  );
};

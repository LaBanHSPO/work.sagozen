import { AuthService } from '@affine/core/modules/cloud';
import type {
  DialogComponentProps,
  WORKSPACE_DIALOG_SCHEMA,
} from '@affine/core/modules/dialogs';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useEffect } from 'react';

import { AboutGroup } from './about';
import { AppearanceGroup } from './appearance';
import { DevicesGroup } from './devices';
import { ExperimentalFeatureSetting } from './experimental';
import { SettingGroup } from './group';
import { DeleteAccount } from './others/delete-account';
import * as styles from './style.css';
import { PlansGroup } from './subscription';
import { SwipeDialog } from './swipe-dialog';
import { UserProfile } from './user-profile';
import { UserUsage } from './user-usage';

const DangerZoneGroup = ({
  onDeleteFinished,
}: {
  onDeleteFinished?: () => void;
}) => {
  const t = useI18n();
  const authService = useService(AuthService);
  const account = useLiveData(authService.session.account$);

  if (!account) {
    return null;
  }

  return (
    <SettingGroup
      title={
        <span className={styles.dangerZoneTitle}>
          {t['com.affine.mobile.setting.danger-zone.title']()}
        </span>
      }
    >
      <DeleteAccount onDeleteFinished={onDeleteFinished} />
    </SettingGroup>
  );
};

const MobileSetting = ({
  onDeleteFinished,
}: {
  onDeleteFinished?: () => void;
}) => {
  const session = useService(AuthService).session;
  const status = useLiveData(session.status$);

  useEffect(() => {
    session.revalidate();
  }, [session]);

  return (
    <div className={styles.root}>
      <UserProfile />
      <UserUsage />
      <PlansGroup />
      {status === 'authenticated' ? <DevicesGroup /> : null}
      <AppearanceGroup />
      <AboutGroup />
      <ExperimentalFeatureSetting />
      <DangerZoneGroup onDeleteFinished={onDeleteFinished} />
    </div>
  );
};

export const SettingDialog = ({
  close,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['setting']>) => {
  const t = useI18n();

  return (
    <SwipeDialog
      title={t['com.affine.mobile.setting.header-title']()}
      open
      onOpenChange={() => close()}
    >
      <MobileSetting onDeleteFinished={close} />
    </SwipeDialog>
  );
};

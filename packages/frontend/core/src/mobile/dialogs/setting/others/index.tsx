import { useI18n } from '@affine/i18n';

import { SettingGroup } from '../group';

export const OthersGroup = () => {
  const t = useI18n();

  return <SettingGroup title={t['com.affine.mobile.setting.others.title']()} />;
};

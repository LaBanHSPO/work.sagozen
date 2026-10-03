import { MenuItem } from '@affine/component/ui/menu';
import { useI18n } from '@affine/i18n';
import { PlusIcon } from '@blocksuite/icons/rc';

import * as styles from './index.css';

export const AddWorkspace = ({
  onNewWorkspace,
}: {
  onNewWorkspace?: () => void;
}) => {
  const t = useI18n();
  return (
    <MenuItem
      block={true}
      prefixIcon={<PlusIcon />}
      prefixIconClassName={styles.prefixIcon}
      onClick={onNewWorkspace}
      data-testid="new-workspace"
      className={styles.ItemContainer}
    >
      <div className={styles.ItemText}>
        {t['com.affine.workspaceList.addWorkspace.create-cloud']()}
      </div>
    </MenuItem>
  );
};

import { notify } from '@affine/component';
import type {
  DialogComponentProps,
  GLOBAL_DIALOG_SCHEMA,
} from '@affine/core/modules/dialogs';
import { useEffect } from 'react';

export const ImportWorkspaceDialog = ({
  close,
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['import-workspace']>) => {
  useEffect(() => {
    notify.error({
      title: 'Local workspaces are disabled',
      message: 'Create or join a cloud workspace instead.',
    });
    close();
  }, [close]);
  return null;
};

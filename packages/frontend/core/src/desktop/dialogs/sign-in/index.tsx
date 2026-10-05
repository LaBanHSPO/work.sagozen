import { Modal } from '@affine/component';
import { SignInPanel } from '@affine/core/components/sign-in';
import type { AuthSessionStatus } from '@affine/core/modules/cloud/entities/session';
import type {
  DialogComponentProps,
  GLOBAL_DIALOG_SCHEMA,
} from '@affine/core/modules/dialogs';
import { useCallback } from 'react';
export const SignInDialog = ({
  close,
}: DialogComponentProps<GLOBAL_DIALOG_SCHEMA['sign-in']>) => {
  const onAuthenticated = useCallback(
    (status: AuthSessionStatus) => {
      if (status === 'authenticated') {
        close();
      }
    },
    [close]
  );
  return (
    <Modal
      open
      persistent
      onOpenChange={() => close()}
      width={400}
      contentOptions={{
        ['data-testid' as string]: 'auth-modal',
        style: {
          padding: '44px 40px 20px',
          minHeight: 550,
          maxHeight: 650,
        },
      }}
    >
      <SignInPanel
        onAuthenticated={onAuthenticated}
      />
    </Modal>
  );
};

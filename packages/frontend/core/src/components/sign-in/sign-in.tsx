import { Button, notify } from '@affine/component';
import {
  AuthContainer,
  AuthContent,
  AuthHeader,
  AuthInput,
} from '@affine/component/auth-components';
import { useAsyncCallback } from '@affine/core/components/hooks/affine-async-hooks';
import {
  AuthService,
  ServerService,
} from '@affine/core/modules/cloud';
import type { AuthSessionStatus } from '@affine/core/modules/cloud/entities/session';
import { SELF_HOSTED_SERVER_URL } from '@affine/core/modules/cloud/self-hosted-sign-in';
import { ServerDeploymentType } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { ArrowRightBigIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { cssVar } from '@toeverything/theme';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useState,
} from 'react';

import { useSelfhostLoginVersionGuard } from '../hooks/affine/use-selfhost-login-version-guard';
import type { SignInState } from '.';
import * as style from './style.css';

const emailRegex =
  /^(?:(?:[^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@(?:(?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|((?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

function validateEmail(email: string) {
  return emailRegex.test(email);
}

export const SignInStep = ({
  changeState,
  onAuthenticated,
}: {
  changeState: Dispatch<SetStateAction<SignInState>>;
  onAuthenticated?: (status: AuthSessionStatus) => void;
}) => {
  const t = useI18n();
  const serverService = useService(ServerService);
  const versionError = useSelfhostLoginVersionGuard(serverService.server);
  const isSelfhosted = useLiveData(
    serverService.server.config$.selector(
      c => c.type === ServerDeploymentType.Selfhosted
    )
  );
  const signInServerName = SELF_HOSTED_SERVER_URL;
  const authService = useService(AuthService);
  const [isMutating, setIsMutating] = useState(false);

  const [email, setEmail] = useState('');

  const [isValidEmail, setIsValidEmail] = useState(true);

  const loginStatus = useLiveData(authService.session.status$);

  useEffect(() => {
    if (loginStatus === 'authenticated') {
      notify.success({
        title: t['com.affine.auth.toast.title.signed-in'](),
        message: t['com.affine.auth.toast.message.signed-in'](),
      });
    }
    onAuthenticated?.(loginStatus);
  }, [loginStatus, onAuthenticated, t]);

  const onContinue = useAsyncCallback(async () => {
    if (!validateEmail(email)) {
      setIsValidEmail(false);
      return;
    }

    setIsValidEmail(true);
    setIsMutating(true);

    try {
      await authService.checkUserByEmail(email);

      changeState(prev => ({
        ...prev,
        email,
        step: 'signInWithPassword',
      }));
    } catch (err) {
      console.error(err);

      notify.error({
        title: 'Failed to sign in',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    setIsMutating(false);
  }, [authService, changeState, email]);


  if (versionError && isSelfhosted) {
    return (
      <AuthContainer>
        <AuthHeader
          title={t['com.affine.auth.sign.in']()}
          subTitle={signInServerName}
        />
        <AuthContent>
          <div>{versionError}</div>
        </AuthContent>
      </AuthContainer>
    );
  }

  return (
    <AuthContainer>
      <AuthHeader
        title={t['com.affine.auth.sign.in']()}
        subTitle={signInServerName}
      />

      <AuthContent>

        <form
          onSubmit={event => {
            event.preventDefault();
            onContinue();
          }}
        >
          <AuthInput
            className={style.authInput}
            label={t['com.affine.settings.email']()}
            placeholder={t['com.affine.auth.sign.email.placeholder']()}
            onChange={setEmail}
            error={!isValidEmail}
            errorHint={
              isValidEmail ? '' : t['com.affine.auth.sign.email.error']()
            }
            onEnter={onContinue}
            type="email"
            name="username"
            autoComplete="username"
          />

          <Button
            className={style.signInButton}
            style={{ width: '100%' }}
            size="extraLarge"
            data-testid="continue-login-button"
            block
            loading={isMutating}
            disabled={isMutating}
            suffix={<ArrowRightBigIcon />}
            suffixStyle={{ width: 20, height: 20, color: cssVar('blue') }}
          >
            {t['com.affine.auth.sign.email.continue']()}
          </Button>
        </form>

      </AuthContent>
    </AuthContainer>
  );
};

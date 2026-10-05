import { DefaultServerService } from '@affine/core/modules/cloud';
import type { AuthSessionStatus } from '@affine/core/modules/cloud/entities/session';
import {
  getSelfHostedSignInUrl,
  SELF_HOSTED_SERVER_URL,
} from '@affine/core/modules/cloud/self-hosted-sign-in';
import { FrameworkScope, useService } from '@toeverything/infra';
import { useEffect, useState } from 'react';

import { SignInStep } from './sign-in';
import { SignInWithPasswordStep } from './sign-in-with-password';

export type SignInStep = 'signIn' | 'signInWithPassword';

export interface SignInState {
  step: SignInStep;
  email?: string;
}

export const SignInPanel = ({
  onAuthenticated,
  redirectUrl,
}: {
  onAuthenticated?: (status: AuthSessionStatus) => void;
  redirectUrl?: string;
}) => {
  const shouldRedirect = location.origin !== SELF_HOSTED_SERVER_URL;
  const [state, setState] = useState<SignInState>({
    step: 'signIn',
  });

  const defaultServerService = useService(DefaultServerService);
  useEffect(() => {
    if (shouldRedirect) {
      // Web authentication uses same-origin cookies on the fixed server.
      location.replace(getSelfHostedSignInUrl(redirectUrl));
    }
  }, [redirectUrl, shouldRedirect]);

  const step = state.step;
  const server = defaultServerService.server;

  if (shouldRedirect) {
    return null;
  }

  return (
    <FrameworkScope scope={server.scope}>
      {step === 'signIn' ? (
        <SignInStep
          changeState={setState}
          onAuthenticated={onAuthenticated}
        />
      ) : step === 'signInWithPassword' ? (
        <SignInWithPasswordStep
          state={state}
          changeState={setState}
          onAuthenticated={onAuthenticated}
        />
      ) : null}
    </FrameworkScope>
  );
};

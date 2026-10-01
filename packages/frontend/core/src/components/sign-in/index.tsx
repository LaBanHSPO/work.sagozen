import { DefaultServerService, type Server } from '@affine/core/modules/cloud';
import type { AuthSessionStatus } from '@affine/core/modules/cloud/entities/session';
import {
  getSelfHostedSignInUrl,
  isFixedSelfHostedSignIn,
  SELF_HOSTED_SERVER_URL,
} from '@affine/core/modules/cloud/self-hosted-sign-in';
import { FrameworkScope, useService } from '@toeverything/infra';
import { useEffect, useState } from 'react';

import { AddSelfhostedStep } from './add-selfhosted';
import { SignInStep } from './sign-in';
import { SignInWithEmailStep } from './sign-in-with-email';
import { SignInWithPasswordStep } from './sign-in-with-password';

export type SignInStep =
  | 'signIn'
  | 'signInWithPassword'
  | 'signInWithEmail'
  | 'addSelfhosted';

export interface SignInState {
  step: SignInStep;
  server?: Server;
  initialServerBaseUrl?: string;
  email?: string;
  hasPassword?: boolean;
  redirectUrl?: string;
}

export const SignInPanel = ({
  onSkip,
  server: initialServerBaseUrl,
  initStep,
  onAuthenticated,
  redirectUrl,
}: {
  onAuthenticated?: (status: AuthSessionStatus) => void;
  onSkip: () => void;
  server?: string;
  initStep?: SignInStep | undefined;
  redirectUrl?: string;
}) => {
  const selfHostedOnly = isFixedSelfHostedSignIn();
  const shouldRedirect =
    selfHostedOnly && location.origin !== SELF_HOSTED_SERVER_URL;
  const [state, setState] = useState<SignInState>({
    step: selfHostedOnly
      ? 'signIn'
      : (initStep ?? (initialServerBaseUrl ? 'addSelfhosted' : 'signIn')),
    initialServerBaseUrl: selfHostedOnly ? undefined : initialServerBaseUrl,
    redirectUrl,
  });

  const defaultServerService = useService(DefaultServerService);
  useEffect(() => {
    if (shouldRedirect) {
      // Web authentication uses same-origin cookies on the fixed server.
      location.replace(getSelfHostedSignInUrl(redirectUrl));
    }
  }, [redirectUrl, shouldRedirect]);

  const step = state.step;
  const server = selfHostedOnly
    ? defaultServerService.server
    : (state.server ?? defaultServerService.server);

  if (shouldRedirect) {
    return null;
  }

  return (
    <FrameworkScope scope={server.scope}>
      {step === 'signIn' ? (
        <SignInStep
          state={state}
          changeState={setState}
          onSkip={onSkip}
          onAuthenticated={onAuthenticated}
        />
      ) : step === 'signInWithEmail' && !selfHostedOnly ? (
        <SignInWithEmailStep
          state={state}
          changeState={setState}
          onAuthenticated={onAuthenticated}
        />
      ) : step === 'signInWithPassword' ? (
        <SignInWithPasswordStep
          state={state}
          changeState={setState}
          onAuthenticated={onAuthenticated}
        />
      ) : step === 'addSelfhosted' && !selfHostedOnly ? (
        <AddSelfhostedStep state={state} changeState={setState} />
      ) : null}
    </FrameworkScope>
  );
};

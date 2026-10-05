import { Button } from '@affine/component/ui/button';
import { ServerService } from '@affine/core/modules/cloud';
import { UrlService } from '@affine/core/modules/url';
import { OAuthProviderType } from '@affine/graphql';
import track from '@affine/track';
import {
  AppleIcon,
  GithubIcon,
  GoogleIcon,
  LockIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { type ReactElement, type SVGAttributes, useCallback } from 'react';

const OAuthProviderMap: Record<
  OAuthProviderType,
  {
    icon: ReactElement<SVGAttributes<SVGElement>>;
  }
> = {
  [OAuthProviderType.Google]: {
    icon: <GoogleIcon />,
  },

  [OAuthProviderType.GitHub]: {
    icon: <GithubIcon />,
  },

  [OAuthProviderType.OIDC]: {
    icon: <LockIcon />,
  },

  [OAuthProviderType.Apple]: {
    icon: <AppleIcon />,
  },
};

export function OAuth({ redirectUrl }: { redirectUrl?: string }) {
  const serverService = useService(ServerService);
  const urlService = useService(UrlService);
  const oauth = useLiveData(serverService.server.features$.map(r => r?.oauth));
  const oauthProviders = useLiveData(
    serverService.server.config$.map(r => r?.oauthProviders)
  );

  const onContinue = useCallback(
    (provider: OAuthProviderType) => {
      track.$.$.auth.signIn({ method: 'oauth', provider });

      const params = new URLSearchParams();
      params.set('provider', provider);
      if (redirectUrl) {
        params.set('redirect_uri', redirectUrl);
      }
      params.set('flow', 'redirect');
      const oauthUrl =
        serverService.server.baseUrl + `/oauth/login?${params.toString()}`;
      urlService.openExternal(oauthUrl);
    },
    [urlService, redirectUrl, serverService]
  );

  if (!oauth) {
    return null;
  }

  return oauthProviders?.map(provider => {
    return (
      <OAuthProvider
        key={provider}
        provider={provider}
        onContinue={onContinue}
      />
    );
  });
}

interface OauthProviderProps {
  provider: OAuthProviderType;
  onContinue: (provider: OAuthProviderType) => void;
}

function OAuthProvider({ onContinue, provider }: OauthProviderProps) {
  const { icon } =
    provider in OAuthProviderMap
      ? OAuthProviderMap[provider]
      : { icon: undefined };

  const onClick = useCallback(() => {
    onContinue(provider);
  }, [onContinue, provider]);

  return (
    <Button
      variant={provider === OAuthProviderType.Apple ? 'custom' : 'primary'}
      block
      size="extraLarge"
      style={{ width: '100%' }}
      prefix={icon}
      onClick={onClick}
    >
      Continue with {provider}
    </Button>
  );
}

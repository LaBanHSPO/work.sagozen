export const SELF_HOSTED_SERVER_URL = 'https://work.computeruse.best';

export function isFixedSelfHostedSignIn() {
  return BUILD_CONFIG.isWeb || BUILD_CONFIG.isMobileWeb;
}

export function getSelfHostedSignInUrl(redirectUrl?: string) {
  const url = new URL('/sign-in', SELF_HOSTED_SERVER_URL);
  if (redirectUrl) {
    url.searchParams.set('redirect_uri', redirectUrl);
  }
  return url.toString();
}

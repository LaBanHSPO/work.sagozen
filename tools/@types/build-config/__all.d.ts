declare interface BUILD_CONFIG_TYPE {
  debug: boolean;
  distribution: 'web' | 'admin';
  /** Browser shell layout, independent of the device's screen size. */
  isDesktopEdition: boolean;
  isWeb: boolean;
  isAdmin: boolean;

  appVersion: string;
  editorVersion: string;
  appBuildType: 'stable' | 'beta' | 'internal' | 'canary';

  githubUrl: string;
  changelogUrl: string;
  pricingUrl: string;
  downloadUrl: string;
  discordUrl: string;
  requestLicenseUrl: string;
  // see: tools/workers
  imageProxyUrl: string;
  linkPreviewUrl: string;

  SENTRY_DSN: string;
}

declare var BUILD_CONFIG: BUILD_CONFIG_TYPE;

import { useAppSettingHelper } from '@affine/core/components/hooks/affine/use-app-setting-helper';
import { RootAppSidebar } from '@affine/core/components/root-app-sidebar';
import { AppSidebarService } from '@affine/core/modules/app-sidebar';
import {
  AppSidebarFallback,
} from '@affine/core/modules/app-sidebar/views';
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@toeverything/infra';
import clsx from 'clsx';
import {
  forwardRef,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactElement,
} from 'react';

import * as styles from './styles.css';

export const AppContainer = ({
  children,
  className,
  fallback = false,
  ...rest
}: PropsWithChildren<{
  className?: string;
  fallback?: boolean;
}>) => {
  const { appSettings } = useAppSettingHelper();

  const noisyBackground = appSettings.enableNoisyBackground;
  return (
    <div
      {...rest}
      className={clsx(styles.appStyle, className, {
        'noisy-background': noisyBackground,
      })}
      data-noise-background={noisyBackground}
    >
      <BrowserLayout fallback={fallback}>{children}</BrowserLayout>
    </div>
  );
};


const BrowserLayout = ({
  children,
  fallback = false,
}: PropsWithChildren<{ fallback?: boolean }>) => {
  const workspaceService = useServiceOptional(WorkspaceService);
  const isInWorkspace = !!workspaceService;

  return (
    <div className={styles.browserAppViewContainer}>
      {fallback ? <AppSidebarFallback /> : isInWorkspace && <RootAppSidebar />}
      <MainContainer>{children}</MainContainer>
    </div>
  );
};


const MainContainer = forwardRef<
  HTMLDivElement,
  PropsWithChildren<HTMLAttributes<HTMLDivElement>>
>(function MainContainer({ className, children, ...props }, ref): ReactElement {
  const workspaceService = useServiceOptional(WorkspaceService);
  const isInWorkspace = !!workspaceService;
  const appSidebarService = useService(AppSidebarService).sidebar;
  const open = useLiveData(appSidebarService.open$);

  return (
    <div
      {...props}
      className={clsx(styles.mainContainerStyle, className)}
      data-side-bar-open={open && isInWorkspace}
      data-testid="main-container"
      ref={ref}
    >
      {children}
    </div>
  );
});

MainContainer.displayName = 'MainContainer';

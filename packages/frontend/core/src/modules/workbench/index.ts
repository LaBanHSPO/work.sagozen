export { View as WorkbenchView } from './entities/view';
export { Workbench } from './entities/workbench';
export { ViewScope } from './scopes/view';
export { ViewService } from './services/view';
export { WorkbenchService } from './services/workbench';
export { useBindWorkbenchToBrowserRouter } from './view/browser-adapter';
export { useIsActiveView } from './view/use-is-active-view';
export { ViewBody, ViewHeader, ViewSidebarTab } from './view/view-islands';
export { ViewIcon, ViewTitle } from './view/view-meta';
export type { WorkbenchLinkProps } from './view/workbench-link';
export { WorkbenchLink } from './view/workbench-link';
export { WorkbenchRoot } from './view/workbench-root';

import { type Framework } from '@toeverything/infra';

import { GlobalState } from '../storage';
import { WorkspaceScope } from '../workspace';
import { SidebarTab } from './entities/sidebar-tab';
import { View } from './entities/view';
import { Workbench } from './entities/workbench';
import { ViewScope } from './scopes/view';
import { ViewService } from './services/view';
import { WorkbenchService } from './services/workbench';
import {
  BrowserWorkbenchNewTabHandler,
  WorkbenchNewTabHandler,
} from './services/workbench-new-tab-handler';
import {
  InMemoryWorkbenchDefaultState,
  WorkbenchDefaultState,
} from './services/workbench-view-state';

export function configureWorkbenchCommonModule(services: Framework) {
  services
    .scope(WorkspaceScope)
    .service(WorkbenchService)
    .entity(Workbench, [
      WorkbenchDefaultState,
      WorkbenchNewTabHandler,
      GlobalState,
    ])
    .entity(View)
    .scope(ViewScope)
    .service(ViewService, [ViewScope])
    .entity(SidebarTab);
}

export function configureBrowserWorkbenchModule(services: Framework) {
  configureWorkbenchCommonModule(services);
  services
    .scope(WorkspaceScope)
    .impl(WorkbenchDefaultState, InMemoryWorkbenchDefaultState)
    .impl(WorkbenchNewTabHandler, () => BrowserWorkbenchNewTabHandler);
}


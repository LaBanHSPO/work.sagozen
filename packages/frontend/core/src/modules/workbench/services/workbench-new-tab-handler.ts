import { createIdentifier } from '@toeverything/infra';
import { type To } from 'history';


export type WorkbenchNewTabHandler = {
  handle: (option: { basename: string; to: To; show: boolean }) => void;
};

export const WorkbenchNewTabHandler = createIdentifier<WorkbenchNewTabHandler>(
  'WorkbenchNewTabHandler'
);

export const BrowserWorkbenchNewTabHandler: WorkbenchNewTabHandler = {
  handle: ({ basename, to }) => {
    const link =
      basename +
      (typeof to === 'string' ? to : `${to.pathname}${to.search}${to.hash}`);
    window.open(link, '_blank');
  },
};


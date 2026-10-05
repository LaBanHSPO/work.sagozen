import { createIdentifier } from '@toeverything/infra';
import { nanoid } from 'nanoid';

import type { ViewIconName } from '../constants';

export type WorkbenchDefaultState = {
  basename: string;
  views: {
    id: string;
    path?: { pathname?: string; hash?: string; search?: string };
    icon?: ViewIconName;
    title?: string;
  }[];
  activeViewIndex: number;
};

export const WorkbenchDefaultState = createIdentifier<WorkbenchDefaultState>(
  'WorkbenchDefaultState'
);

export const InMemoryWorkbenchDefaultState: WorkbenchDefaultState = {
  basename: '/',
  views: [
    {
      id: nanoid(),
    },
  ],
  activeViewIndex: 0,
};


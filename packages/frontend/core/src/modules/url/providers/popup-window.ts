import { createIdentifier } from '@toeverything/infra';

export interface PopupWindowProvider {
  /**
   * Opens a new browser window.
   */
  open(url: string): void;
}

export const PopupWindowProvider = createIdentifier<PopupWindowProvider>(
  'PopupWindowProvider'
);

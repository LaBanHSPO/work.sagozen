import { Service } from '@toeverything/infra';

import type { PopupWindowProvider } from '../providers/popup-window';

export class UrlService extends Service {
  constructor(private readonly popupWindowProvider?: PopupWindowProvider) {
    super();
  }

  /**
   * Opens a new browser window.
   *
   * !IMPORTANT: browser will block popup windows in async callbacks, so you should use openExternal instead.
   *
   * @param url only full url with http/https protocol is supported
   */
  openPopupWindow(url: string) {
    if (!url.startsWith('http')) {
      throw new Error('only full url with http/https protocol is supported');
    }
    this.popupWindowProvider?.open(url);
  }

  /**
   * Opens an external URL in the current browser tab.
   * Unlike openPopupWindow, openExternal opens the URL in the current browser tab,
   * making it more suitable for cases where popup windows might be blocked by browsers.
   *
   * @param url only full url with http/https protocol is supported
   */
  openExternal(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid external URL: ${url}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('only http/https URLs are supported');
    }
    location.href = url;
  }
}

import { setupGlobal } from '@affine/env/global';
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

setupGlobal();

export type AppSetting = {
  enableNoisyBackground: boolean;
  enableTelemetry: boolean;
  showLinkedDocInSidebar: boolean;
  disableImageAntialiasing: boolean;
};

export const APP_SETTINGS_STORAGE_KEY = 'affine-settings';
const appSettingBaseAtom = atomWithStorage<AppSetting>(
  APP_SETTINGS_STORAGE_KEY,
  {
    enableNoisyBackground: true,
    enableTelemetry: false,
    showLinkedDocInSidebar: true,
    disableImageAntialiasing: false,
  },
  undefined,
  {
    getOnInit: true,
  }
);

type SetStateAction<Value> = Value | ((prev: Value) => Value);

export const appSettingAtom = atom<
  AppSetting,
  [SetStateAction<Partial<AppSetting>>],
  void
>(
  get => get(appSettingBaseAtom),
  (_get, set, apply) => {
    set(appSettingBaseAtom, prev => {
      const next = typeof apply === 'function' ? apply(prev) : apply;
      return { ...prev, ...next };
    });
  }
);

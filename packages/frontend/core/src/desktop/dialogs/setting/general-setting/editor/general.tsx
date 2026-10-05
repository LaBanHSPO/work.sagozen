import {
  Menu,
  MenuItem,
  type MenuProps,
  MenuTrigger,
  RadioGroup,
  type RadioItem,
  Slider,
  Switch,
  useConfirmModal,
} from '@affine/component';
import {
  SettingRow,
  SettingWrapper,
} from '@affine/component/setting-components';
import { ServerService } from '@affine/core/modules/cloud';
import {
  type EditorSettingSchema,
  EditorSettingService,
  type FontFamily,
  fontStyleOptions,
  type NewDocDateTitleFormat,
  newDocDateTitleFormatOptions,
} from '@affine/core/modules/editor-setting';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService, useServices } from '@toeverything/infra';
import {
  useCallback,
  useEffect,
  useMemo,
} from 'react';

import * as styles from './style.css';

const getLabel = (fontKey: FontFamily, t: ReturnType<typeof useI18n>) => {
  switch (fontKey) {
    case 'Sans':
      return t['com.affine.appearanceSettings.fontStyle.sans']();
    case 'Serif':
      return t['com.affine.appearanceSettings.fontStyle.serif']();
    case 'Mono':
      return t[`com.affine.appearanceSettings.fontStyle.mono`]();
    case 'Custom':
      return t['com.affine.settings.editorSettings.edgeless.custom']();
    default:
      return '';
  }
};

export const getBaseFontStyleOptions = (
  t: ReturnType<typeof useI18n>
): Array<Omit<RadioItem, 'value'> & { value: FontFamily }> => {
  return fontStyleOptions
    .map(({ key, value }) => {
      if (key === 'Custom') {
        return null;
      }
      const label = getLabel(key, t);
      return {
        value: key,
        label,
        testId: 'system-font-style-trigger',
        style: {
          fontFamily: value,
        },
      } satisfies RadioItem;
    })
    .filter(item => item !== null);
};

const FontFamilySettings = () => {
  const t = useI18n();
  const { editorSettingService } = useServices({ EditorSettingService });
  const settings = useLiveData(editorSettingService.editorSetting.settings$);

  const radioItems = useMemo(() => getBaseFontStyleOptions(t), [t]);

  const handleFontFamilyChange = useCallback(
    (value: FontFamily) => {
      editorSettingService.editorSetting.set('fontFamily', value);
    },
    [editorSettingService.editorSetting]
  );

  return (
    <SettingRow
      name={t['com.affine.appearanceSettings.font.title']()}
      desc={t['com.affine.appearanceSettings.font.description']()}
    >
      <RadioGroup
        items={radioItems}
        value={settings.fontFamily}
        width={250}
        className={styles.settingWrapper}
        onChange={handleFontFamilyChange}
      />
    </SettingRow>
  );
};

const FontSizeSettings = () => {
  const t = useI18n();
  const { editorSettingService } = useServices({ EditorSettingService });
  const settings = useLiveData(editorSettingService.editorSetting.settings$);

  const onFontSizeChange = useCallback(
    (fontSize: number[]) => {
      const size = fontSize[0];
      editorSettingService.editorSetting.set('fontSize', size);
      // Update CSS variable immediately
      document.documentElement.style.setProperty(
        '--affine-font-base',
        `${size}px`
      );
    },
    [editorSettingService.editorSetting]
  );

  // Apply current font size to CSS variable on mount
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--affine-font-base',
      `${settings.fontSize}px`
    );
  }, [settings.fontSize]);

  return (
    <SettingRow
      name={t['com.affine.settings.editorSettings.general.font-size.title']()}
      desc={t[
        'com.affine.settings.editorSettings.general.font-size.description'
      ]()}
    >
      <div className={styles.fontSizeContainer}>
        <Slider
          value={[settings.fontSize]}
          onValueChange={onFontSizeChange}
          min={12}
          max={24}
          step={1}
          className={styles.fontSizeSlider}
        />
        <span className={styles.fontSizeValue}>{settings.fontSize}px</span>
      </div>
    </SettingRow>
  );
};

const menuContentOptions: MenuProps['contentOptions'] = {
  align: 'end',
  sideOffset: 16,
  style: { width: 250 },
};
const NewDocDefaultModeSettings = () => {
  const t = useI18n();
  const { editorSettingService } = useServices({ EditorSettingService });
  const settings = useLiveData(editorSettingService.editorSetting.settings$);
  const items = useMemo(
    () =>
      [
        {
          value: 'page',
          label: t['Page'](),
          testId: 'page-mode-trigger',
        },
        {
          value: 'edgeless',
          label: t['Edgeless'](),
          testId: 'edgeless-mode-trigger',
        },
        {
          value: 'ask',
          label: t['com.affine.settings.editorSettings.ask-me-every-time'](),
          testId: 'ask-every-time-trigger',
        },
      ] as const,
    [t]
  );
  const updateNewDocDefaultMode = useCallback(
    (value: EditorSettingSchema['newDocDefaultMode']) => {
      editorSettingService.editorSetting.set('newDocDefaultMode', value);
    },
    [editorSettingService.editorSetting]
  );
  return (
    <SettingRow
      name={t[
        'com.affine.settings.editorSettings.general.default-new-doc.title'
      ]()}
      desc={t[
        'com.affine.settings.editorSettings.general.default-new-doc.description'
      ]()}
    >
      <Menu
        contentOptions={menuContentOptions}
        items={items.map(item => {
          return (
            <MenuItem
              key={item.value}
              selected={item.value === settings.newDocDefaultMode}
              onSelect={() => updateNewDocDefaultMode(item.value)}
              data-testid={item.testId}
            >
              {item.label}
            </MenuItem>
          );
        })}
      >
        <MenuTrigger
          className={styles.menuTrigger}
          data-testid="new-doc-default-mode-trigger"
        >
          {items.find(item => item.value === settings.newDocDefaultMode)?.label}
        </MenuTrigger>
      </Menu>
    </SettingRow>
  );
};

const getDateTitleFormatLabel = (format: NewDocDateTitleFormat) => {
  return `com.affine.settings.editorSettings.general.auto-date-title.format.${format.toLowerCase()}` as const;
};

export const NewDocDateTitleSettings = () => {
  const t = useI18n();
  const { editorSettingService } = useServices({ EditorSettingService });
  const settings = useLiveData(editorSettingService.editorSetting.settings$);
  const formatItems = useMemo(
    () =>
      newDocDateTitleFormatOptions.map(value => ({
        value,
        label: t.t(getDateTitleFormatLabel(value)),
      })),
    [t]
  );

  const onToggleAutoDateTitle = useCallback(
    (checked: boolean) => {
      editorSettingService.editorSetting.set(
        'autoTitleNewDocWithCurrentDate',
        checked
      );
    },
    [editorSettingService.editorSetting]
  );

  const onDateTitleFormatChange = useCallback(
    (value: NewDocDateTitleFormat) => {
      editorSettingService.editorSetting.set('newDocDateTitleFormat', value);
    },
    [editorSettingService.editorSetting]
  );

  const onToggleDisplayAddIconOption = useCallback(
    (checked: boolean) => {
      editorSettingService.editorSetting.set('displayAddIconOption', checked);
    },
    [editorSettingService.editorSetting]
  );

  return (
    <>
      <SettingRow
        name={t[
          'com.affine.settings.editorSettings.general.auto-date-title.title'
        ]()}
        desc={t[
          'com.affine.settings.editorSettings.general.auto-date-title.description'
        ]()}
      >
        <Switch
          data-testid="auto-title-new-doc-trigger"
          checked={settings.autoTitleNewDocWithCurrentDate}
          onChange={onToggleAutoDateTitle}
        />
      </SettingRow>
      {settings.autoTitleNewDocWithCurrentDate ? (
        <SettingRow
          name={t[
            'com.affine.settings.editorSettings.general.auto-date-title.format.title'
          ]()}
          desc={t[
            'com.affine.settings.editorSettings.general.auto-date-title.format.description'
          ]()}
        >
          <Menu
            contentOptions={menuContentOptions}
            items={formatItems.map(item => (
              <MenuItem
                key={item.value}
                selected={item.value === settings.newDocDateTitleFormat}
                onSelect={() => onDateTitleFormatChange(item.value)}
              >
                {item.label}
              </MenuItem>
            ))}
          >
            <MenuTrigger
              className={styles.menuTrigger}
              data-testid="new-doc-date-title-format-trigger"
            >
              {
                formatItems.find(
                  item => item.value === settings.newDocDateTitleFormat
                )?.label
              }
            </MenuTrigger>
          </Menu>
        </SettingRow>
      ) : null}
      <SettingRow
        name={t.t(
          'com.affine.settings.editorSettings.general.add-icon-option.title'
        )}
        desc={t.t(
          'com.affine.settings.editorSettings.general.add-icon-option.description'
        )}
      >
        <Switch
          data-testid="display-add-icon-option-trigger"
          checked={settings.displayAddIconOption}
          onChange={onToggleDisplayAddIconOption}
        />
      </SettingRow>
    </>
  );
};

const AISettings = () => {
  const t = useI18n();
  const { openConfirmModal } = useConfirmModal();
  const { featureFlagService, serverService } = useServices({
    FeatureFlagService,
    ServerService,
  });
  const serverFeatures = useLiveData(serverService.server.features$);
  const enableAI = useLiveData(featureFlagService.flags.enable_ai.$);

  const onAIChange = useCallback(
    (checked: boolean) => {
      featureFlagService.flags.enable_ai.set(checked); // this will trigger page reload, see `FeatureFlagService`
    },
    [featureFlagService]
  );
  const onToggleAI = useCallback(
    (checked: boolean) => {
      openConfirmModal({
        title: checked
          ? t['com.affine.settings.editorSettings.general.ai.enable.title']()
          : t['com.affine.settings.editorSettings.general.ai.disable.title'](),
        description: checked
          ? t[
              'com.affine.settings.editorSettings.general.ai.enable.description'
            ]()
          : t[
              'com.affine.settings.editorSettings.general.ai.disable.description'
            ](),
        confirmText: checked
          ? t['com.affine.settings.editorSettings.general.ai.enable.confirm']()
          : t[
              'com.affine.settings.editorSettings.general.ai.disable.confirm'
            ](),
        cancelText: t['Cancel'](),
        onConfirm: () => onAIChange(checked),
        confirmButtonOptions: {
          variant: checked ? 'primary' : 'error',
        },
      });
    },
    [openConfirmModal, t, onAIChange]
  );

  if (!serverFeatures?.copilot) {
    return null;
  }

  return (
    <SettingRow
      name={t['com.affine.settings.editorSettings.general.ai.title']()}
      desc={t['com.affine.settings.editorSettings.general.ai.description']()}
    >
      <Switch checked={enableAI} onChange={onToggleAI} />
    </SettingRow>
  );
};

const MiddleClickPasteSettings = () => {
  const t = useI18n();
  const editorSettingService = useService(EditorSettingService);
  const settings = useLiveData(editorSettingService.editorSetting.settings$);
  const onToggleMiddleClickPaste = useCallback(
    (checked: boolean) => {
      editorSettingService.editorSetting.set('enableMiddleClickPaste', checked);
    },
    [editorSettingService.editorSetting]
  );
  return (
    <SettingRow
      name={t[
        'com.affine.settings.editorSettings.general.middle-click-paste.title'
      ]()}
      desc={t[
        'com.affine.settings.editorSettings.general.middle-click-paste.description'
      ]()}
    >
      <Switch
        checked={settings.enableMiddleClickPaste}
        onChange={onToggleMiddleClickPaste}
      />
    </SettingRow>
  );
};

const DefaultCodeBlockLineNumberSettings = () => {
  const t = useI18n();
  const editorSettingService = useService(EditorSettingService);
  const settings = useLiveData(editorSettingService.editorSetting.settings$);

  const onToggle = useCallback(
    (checked: boolean) => {
      editorSettingService.editorSetting.set('codeBlockLineNumbers', checked);
    },
    [editorSettingService.editorSetting]
  );

  return (
    <SettingRow
      name={t[
        'com.affine.settings.editorSettings.general.default-code-block.line-numbers.title'
      ]()}
      desc={t[
        'com.affine.settings.editorSettings.general.default-code-block.line-numbers.description'
      ]()}
    >
      <Switch
        data-testid="code-block-line-numbers-trigger"
        checked={settings.codeBlockLineNumbers}
        onChange={onToggle}
      />
    </SettingRow>
  );
};

export const General = () => {
  const t = useI18n();

  return (
    <SettingWrapper title={t['com.affine.settings.editorSettings.general']()}>
      <AISettings />
      <FontFamilySettings />
      <FontSizeSettings />
      <NewDocDefaultModeSettings />
      <NewDocDateTitleSettings />
      <DefaultCodeBlockLineNumberSettings />
      {environment.isLinux && <MiddleClickPasteSettings />}
    </SettingWrapper>
  );
};

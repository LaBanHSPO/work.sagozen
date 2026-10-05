import { type Framework } from '@toeverything/infra';

import { ServersService } from '../cloud';
import { DocCreateMiddleware } from '../doc';
import { GlobalState } from '../storage';
import { AppThemeService } from '../theme';
import { WorkspaceScope } from '../workspace';
import { EditorSetting } from './entities/editor-setting';
import { EditorSettingDocCreateMiddleware } from './impls/doc-create-middleware';
import { CurrentUserDBEditorSettingProvider } from './impls/user-db';
import { EditorSettingProvider } from './provider/editor-setting-provider';
import { EditorSettingService } from './services/editor-setting';
export type { FontFamily, NewDocDateTitleFormat } from './schema';
export {
  EditorSettingSchema,
  fontStyleOptions,
  newDocDateTitleFormatOptions,
} from './schema';
export { EditorSettingService } from './services/editor-setting';
export { resolveNewDocTitle } from './utils/date-title';

export function configureEditorSettingModule(framework: Framework) {
  framework
    .service(EditorSettingService)
    .entity(EditorSetting, [EditorSettingProvider])
    .impl(EditorSettingProvider, CurrentUserDBEditorSettingProvider, [
      ServersService,
      GlobalState,
    ])
    .scope(WorkspaceScope)
    .impl(DocCreateMiddleware, EditorSettingDocCreateMiddleware, [
      EditorSettingService,
      AppThemeService,
    ]);
}


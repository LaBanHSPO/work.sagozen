import { KeyboardToolbarExtension } from '@affine/core/blocksuite/view-extensions/mobile/keyboard-toolbar-extension';
import { MobileFeatureFlagControl } from '@affine/core/blocksuite/view-extensions/mobile/mobile-feature-flag-control';
import {
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine/ext-loader';

export class MobileViewExtension extends ViewExtensionProvider {
  override name = 'mobile-view-extension';

  override setup(context: ViewExtensionContext) {
    super.setup(context);
    const isMobile = environment.isMobile;
    if (!isMobile) return;

    context.register(KeyboardToolbarExtension());

    context.register(MobileFeatureFlagControl);
  }
}

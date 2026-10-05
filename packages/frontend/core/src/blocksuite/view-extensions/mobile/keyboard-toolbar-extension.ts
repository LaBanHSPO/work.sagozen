import type { Container } from '@blocksuite/affine/global/di';
import { DisposableGroup } from '@blocksuite/affine/global/disposable';
import { VirtualKeyboardProvider } from '@blocksuite/affine/shared/services';
import { LifeCycleWatcher } from '@blocksuite/affine/std';
import type { ExtensionType } from '@blocksuite/affine/store';
import { batch, signal } from '@preact/signals-core';

export function KeyboardToolbarExtension(): ExtensionType {
  class BrowserVirtualKeyboardService
    extends LifeCycleWatcher
    implements VirtualKeyboardProvider
  {
    static override key = VirtualKeyboardProvider.identifierName;

    private readonly _disposables = new DisposableGroup();

    readonly visible$ = signal(false);

    readonly height$ = signal(0);

    readonly staticHeight$ = signal(0);

    readonly appTabSafeArea$ = signal('env(safe-area-inset-bottom, 0px)');

    static override setup(di: Container) {
      super.setup(di);
      di.addImpl(VirtualKeyboardProvider, provider => provider.get(this));
    }

    override mounted() {
      const viewport = window.visualViewport;
      if (!viewport) return;

      const update = () => {
        const focused = document.activeElement;
        const editing =
          focused instanceof HTMLElement &&
          (focused.isContentEditable ||
            focused instanceof HTMLInputElement ||
            focused instanceof HTMLTextAreaElement);
        const height = Math.max(
          0,
          window.innerHeight - viewport.height - viewport.offsetTop
        );
        const visible = editing && viewport.scale === 1 && height > 100;

        batch(() => {
          if (visible) this.staticHeight$.value = height;
          this.visible$.value = visible;
          this.height$.value = visible ? height : 0;
        });
      };

      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
      document.addEventListener('focusin', update);
      document.addEventListener('focusout', update);
      this._disposables.add(() => {
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
        document.removeEventListener('focusin', update);
        document.removeEventListener('focusout', update);
      });
      update();
    }

    override unmounted() {
      this._disposables.dispose();
    }
  }

  return BrowserVirtualKeyboardService;
}

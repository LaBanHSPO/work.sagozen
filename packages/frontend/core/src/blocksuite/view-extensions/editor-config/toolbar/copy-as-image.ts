import { notify } from '@affine/component';
import { isMindmapChild, isMindMapRoot } from '@affine/core/blocksuite/ai';
import { EditorService } from '@affine/core/modules/editor';
import { I18n } from '@affine/i18n';
import {
  CanvasRenderer,
  ExportManager,
  SurfaceBlockComponent,
} from '@blocksuite/affine/blocks/surface';
import type { MenuContext } from '@blocksuite/affine/components/toolbar';
import { Bound, getCommonBound } from '@blocksuite/affine/global/gfx';
import type { BlockStdScope } from '@blocksuite/affine/std';
import {
  GfxBlockElementModel,
  GfxControllerIdentifier,
  GfxPrimitiveElementModel,
} from '@blocksuite/affine/std/gfx';
import { CopyAsImgaeIcon } from '@blocksuite/icons/lit';
import type { FrameworkProvider } from '@toeverything/infra';

async function selectedElementsToPng(std: BlockStdScope): Promise<Blob> {
  const gfx = std.get(GfxControllerIdentifier);
  let selected = gfx.selection.selectedElements;
  const maybeMindmap = selected[0];
  if (
    selected.length === 1 &&
    maybeMindmap.group &&
    (isMindMapRoot(maybeMindmap) || isMindmapChild(maybeMindmap))
  ) {
    selected = [maybeMindmap.group];
  }

  const bound = getCommonBound(
    selected.map(element => Bound.deserialize(element.xywh))
  );
  const surface = gfx.surfaceComponent;
  if (
    !bound ||
    !(surface instanceof SurfaceBlockComponent) ||
    !(surface.renderer instanceof CanvasRenderer)
  ) {
    throw new Error('The selected elements cannot be rendered as an image');
  }

  const canvas = await std.get(ExportManager).edgelessToCanvas(
    surface.renderer,
    bound,
    gfx,
    selected.filter(
      (element): element is GfxBlockElementModel =>
        element instanceof GfxBlockElementModel
    ),
    selected.filter(
      (element): element is GfxPrimitiveElementModel =>
        element instanceof GfxPrimitiveElementModel
    )
  );
  if (!canvas) {
    throw new Error('Failed to render the selected elements');
  }
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Failed to encode the selected elements as PNG'));
  }, 'image/png');
  return promise;
}

export async function copyAsImage(std: BlockStdScope) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    notify.error({
      title: I18n.t('com.affine.copy.asImage.notAvailable.title'),
      message: I18n.t('com.affine.copy.asImage.notAvailable.message'),
    });
    return;
  }

  try {
    // Start the clipboard write during the user gesture, before rendering awaits.
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': selectedElementsToPng(std) }),
    ]);
    notify.success({ title: I18n.t('com.affine.copy.asImage.success') });
  } catch (error) {
    notify.error({
      title: I18n.t('com.affine.copy.asImage.failed'),
      message: String(error),
    });
  }
}

export function createCopyAsPngMenuItem(framework: FrameworkProvider) {
  return {
    icon: CopyAsImgaeIcon({ width: '20', height: '20' }),
    label: 'Copy as Image',
    type: 'copy-as-image',
    when: (ctx: MenuContext) => {
      if (ctx.isEmpty()) return false;
      const { editor } = framework.get(EditorService);
      const mode = editor.mode$.value;
      return mode === 'edgeless';
    },
    action: (ctx: MenuContext) => copyAsImage(ctx.std),
  };
}

import { OnEvent, Service } from '@toeverything/infra';
import { distinctUntilChanged } from 'rxjs';

import type { FeatureFlagService } from '../../feature-flag';
import { ApplicationStarted } from '../../lifecycle';
import { setMermaidWasmRendererEnabled } from '../runtime-config';

@OnEvent(ApplicationStarted, e => e.syncFlag)
export class PreviewRendererFeatureSyncService extends Service {
  constructor(private readonly featureFlagService: FeatureFlagService) {
    super();
  }

  syncFlag() {
    const mermaidFlag =
      this.featureFlagService.flags.enable_mermaid_wasm_renderer;

    setMermaidWasmRendererEnabled(!!mermaidFlag.value);
    const subscription = mermaidFlag.$.pipe(distinctUntilChanged()).subscribe(
      enabled => {
        setMermaidWasmRendererEnabled(!!enabled);
      }
    );
    this.disposables.push(() => subscription.unsubscribe());
  }
}

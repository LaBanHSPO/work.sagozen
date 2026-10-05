import type { Framework } from '@toeverything/infra';

import { DefaultServerService, WorkspaceServerService } from '../cloud';
import { NbstoreService } from '../storage';
import { WorkbenchService } from '../workbench';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { AudioAttachmentBlock } from './entities/audio-attachment-block';
import { AudioMedia } from './entities/audio-media';
import { AudioTranscriptionJob } from './entities/audio-transcription-job';
import { AudioTranscriptionJobStore } from './entities/audio-transcription-job-store';
import {
  GlobalMediaStateProvider,
  WebGlobalMediaStateProvider,
} from './providers/global-audio-state';
import { AudioAttachmentService } from './services/audio-attachment';
import { AudioMediaManagerService } from './services/audio-media-manager';

export function configureMediaModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .entity(AudioMedia, [WorkspaceService])
    .entity(AudioAttachmentBlock, [
      AudioMediaManagerService,
      WorkspaceService,
    ])
    .entity(AudioTranscriptionJob, [
      WorkspaceServerService,
      DefaultServerService,
    ])
    .entity(AudioTranscriptionJobStore, [
      WorkspaceService,
      WorkspaceServerService,
      DefaultServerService,
      NbstoreService,
    ])
    .service(AudioAttachmentService)
    .service(AudioMediaManagerService, [
      GlobalMediaStateProvider,
      WorkbenchService,
    ]);

  framework.impl(GlobalMediaStateProvider, WebGlobalMediaStateProvider);
}

export { AudioMedia, AudioMediaManagerService };

import {
  createIdentifier,
  LiveData,
  type MediaStats,
  type PlaybackState,
} from '@toeverything/infra';

export const GlobalMediaStateProvider =
  createIdentifier<BaseGlobalMediaStateProvider>('GlobalMediaStateProvider');

/**
 * Base class for media state providers
 */
export abstract class BaseGlobalMediaStateProvider {
  abstract readonly playbackState$: LiveData<PlaybackState | null | undefined>;
  abstract readonly stats$: LiveData<MediaStats | null | undefined>;

  /**
   * Update the playback state
   * @param state Full state object or partial state to update
   */
  abstract updatePlaybackState(state: Partial<PlaybackState> | null): void;

  /**
   * Update the media stats
   * @param stats Full stats object or partial stats to update
   */
  abstract updateStats(stats: Partial<MediaStats> | null): void;
}

/**
 * Provider for global media state in Web environment
 * This is a simplified version that only works within the current tab
 */
export class WebGlobalMediaStateProvider extends BaseGlobalMediaStateProvider {
  readonly playbackState$ = new LiveData<PlaybackState | null | undefined>(
    null
  );
  readonly stats$ = new LiveData<MediaStats | null | undefined>(null);

  /**
   * Update the playback state
   */
  override updatePlaybackState(state: Partial<PlaybackState> | null): void {
    if (state === null) {
      this.playbackState$.setValue(null);
      return;
    }

    const currentState = this.playbackState$.value;
    const newState = currentState
      ? { ...currentState, ...state }
      : (state as PlaybackState);

    this.playbackState$.setValue(newState);
  }

  /**
   * Update the media stats
   */
  override updateStats(stats: Partial<MediaStats> | null): void {
    if (stats === null) {
      this.stats$.setValue(null);
      return;
    }

    const currentStats = this.stats$.value;
    const newStats = currentStats
      ? { ...currentStats, ...stats }
      : (stats as MediaStats);

    this.stats$.setValue(newStats);
  }
}

# Browser Audio State Synchronization

`WebGlobalMediaStateProvider` keeps `PlaybackState` and `MediaStats` in memory
within the current browser tab. Browser tabs do not share playback state.

`AudioMediaManagerService` observes those values and synchronizes the active
attachment's audio entity. Updates include `updateTime`; `distinctUntilChanged`
ignores repeated playback updates, and the entity's `skipUpdate` option avoids
circular updates.

`ensureExclusivePlayback` pauses other audio entities within the current tab
when a new attachment starts playing. The playback controls can navigate to the
active attachment's document and block through the browser workbench.

import { CaptionedBlockComponent } from '@blocksuite/affine-components/caption';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine-components/context-menu';
import { DropIndicator } from '@blocksuite/affine-components/drop-indicator';
import { PeekViewProvider } from '@blocksuite/affine-components/peek';
import { toast } from '@blocksuite/affine-components/toast';
import type { DatabaseBlockModel } from '@blocksuite/affine-model';
import { EDGELESS_TOP_CONTENTEDITABLE_SELECTOR } from '@blocksuite/affine-shared/consts';
import {
  BlockElementCommentManager,
  CommentProviderIdentifier,
  DocModeProvider,
  FeatureFlagService,
  NotificationProvider,
  type TelemetryEventMap,
  TelemetryProvider,
  UserProvider,
} from '@blocksuite/affine-shared/services';
import {
  downloadBlob,
  openSingleFileWith,
} from '@blocksuite/affine-shared/utils';
import { getDropResult } from '@blocksuite/affine-widget-drag-handle';
import {
  createRecordDetail,
  createUniComponentFromWebComponent,
  DataViewRootUILogic,
  type DataViewSelection,
  type DataViewUILogicBase,
  type DataViewWidget,
  type DataViewWidgetProps,
  defineUniComponent,
  ExternalGroupByConfigProvider,
  lazy,
  renderUniLit,
  type SingleView,
  uniMap,
} from '@blocksuite/data-view';
import { CalendarExternalSourceProvider } from '@blocksuite/data-view/view-presets';
import { widgetPresets } from '@blocksuite/data-view/widget-presets';
import { IS_MOBILE } from '@blocksuite/global/env';
import { Rect } from '@blocksuite/global/gfx';
import {
  CommentIcon,
  CopyIcon,
  DeleteIcon,
  MoreHorizontalIcon,
} from '@blocksuite/icons/lit';
import { type BlockComponent, BlockSelection } from '@blocksuite/std';
import { RANGE_SYNC_EXCLUDE_ATTR } from '@blocksuite/std/inline';
import { nanoid, Slice } from '@blocksuite/store';
import { autoUpdate } from '@floating-ui/dom';
import { computed, effect, signal } from '@preact/signals-core';
import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

import { popSideDetail } from './components/layout.js';
import { DatabaseConfigExtension } from './config.js';
import { EditorHostKey } from './context/host-context.js';
import { DatabaseBlockDataSource } from './data-source.js';
import {
  databaseBlockStyles,
  databaseContentStyles,
  databaseHeaderBarStyles,
  databaseHeaderContainerStyles,
  databaseOpsStyles,
  databaseTitleRowStyles,
  databaseTitleStyles,
  databaseToolbarRowStyles,
  databaseViewBarContainerStyles,
} from './database-block-styles.js';
import { BlockRenderer } from './detail-panel/block-renderer.js';
import { NoteRenderer } from './detail-panel/note-renderer.js';
import { DatabaseSelection } from './selection.js';
import { exportDatabaseCsv, importDatabaseCsv } from './utils/csv.js';
import { currentViewStorage } from './utils/current-view.js';
import { getSingleDocIdFromText } from './utils/title-doc.js';
import type { DatabaseViewExtensionOptions } from './view';

const localViewerKey = 'blocksuite:databaseBlock:localViewerId';
let localViewerId: string | undefined;

function getLocalViewerId(): string {
  if (localViewerId) return localViewerId;
  try {
    localViewerId =
      globalThis.localStorage?.getItem(localViewerKey) ?? undefined;
    if (!localViewerId) {
      localViewerId = `local:${nanoid()}`;
      globalThis.localStorage?.setItem(localViewerKey, localViewerId);
    }
  } catch {
    localViewerId = `local:${nanoid()}`;
  }
  const id = localViewerId ?? `local:${nanoid()}`;
  localViewerId = id;
  return id;
}

export class DatabaseBlockComponent extends CaptionedBlockComponent<DatabaseBlockModel> {
  private readonly canManage$ = computed(
    () => this.optionsConfig.canManage$?.value ?? true
  );

  private readonly memberWindowOpen$ = computed(() => {
    const until = this.model.props.memberEditUntil$.value;
    return (
      typeof until === 'number' &&
      Number.isFinite(until) &&
      until > this.dataSource.value.permissionTime$.value
    );
  });

  private setMemberEditing(minutes: string | null) {
    if (!this.canManage$.value || this.store.readonly) return;
    const duration = minutes === null ? 0 : Number(minutes);
    const until = minutes === null ? 0 : Date.now() + duration * 60_000;
    if (
      minutes !== null &&
      (!Number.isSafeInteger(duration) ||
        duration <= 0 ||
        !Number.isSafeInteger(until))
    ) {
      toast(this.host, 'Enter a positive whole number of minutes.');
      return;
    }
    this.store.captureSync();
    this.store.transact(() => {
      this.model.props.memberEditUntil = until;
    });
    toast(
      this.host,
      minutes === null
        ? 'Members can no longer edit this database.'
        : `Member editing opened for ${duration} minutes.`
    );
  }

  private readonly clickDatabaseOps = (e: MouseEvent) => {
    this.memberEditDuration = '15';
    const options = this.optionsConfig.configure(this.model, {
      items: [
        ...(!this.dataSource.value.readonly$.value
          ? [
              menu.input({
                initialValue: this.model.props.title.toString(),
                placeholder: 'Database title',
                onChange: text => {
                  if (this.dataSource.value.readonly$.value) return;
                  this.model.props.title.replace(
                    0,
                    this.model.props.title.length,
                    text
                  );
                },
              }),
            ]
          : []),
        menu.action({
          prefix: CommentIcon(),
          name: 'Comment',
          hide: () => !this.std.getOptional(CommentProviderIdentifier),
          select: () => {
            this.std.getOptional(CommentProviderIdentifier)?.addComment([
              new BlockSelection({
                blockId: this.blockId,
              }),
            ]);
          },
        }),
        menu.action({
          prefix: CopyIcon(),
          name: 'Copy',
          select: () => {
            const slice = Slice.fromModels(this.store, [this.model]);
            this.std.clipboard
              .copySlice(slice)
              .then(() => {
                toast(this.host, 'Copied to clipboard');
              })
              .catch(console.error);
          },
        }),
        menu.group({
          items: [
            menu.action({
              name: 'Export CSV',
              select: () => {
                try {
                  const csv = exportDatabaseCsv(this.dataSource.value);
                  const title = this.model.props.title.toString() || 'Database';
                  downloadBlob(
                    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
                    `${title.replace(/[\\/:*?"<>|]/g, '_')}.csv`
                  );
                } catch (error) {
                  toast(
                    this.host,
                    error instanceof Error
                      ? error.message
                      : 'CSV export failed.'
                  );
                }
              },
            }),
            menu.action({
              name: 'Import CSV',
              hide: () => this.dataSource.value.readonly$.value,
              select: () => {
                const importFile = async () => {
                  if (this.dataSource.value.readonly$.value) return;
                  const file = await openSingleFileWith('Any');
                  if (!file) return;
                  if (!/\.csv$/i.test(file.name)) {
                    throw new Error('Please select a CSV file (.csv).');
                  }
                  const csv = await file.text();
                  // Permissions may expire while the picker or file read is open.
                  const count = importDatabaseCsv(this.dataSource.value, csv);
                  toast(
                    this.host,
                    `Imported ${count} ${count === 1 ? 'row' : 'rows'}.`
                  );
                };
                importFile().catch(error => {
                  toast(
                    this.host,
                    error instanceof Error
                      ? error.message
                      : 'CSV import failed.'
                  );
                });
              },
            }),
          ],
        }),
        menu.subMenu({
          name: 'Member editing',
          hide: () => !this.canManage$.value || this.store.readonly,
          options: {
            title: { text: 'Member editing (minutes)' },
            items: [
              menu.input({
                initialValue: '15',
                placeholder: 'Duration in minutes',
                onChange: value => {
                  this.memberEditDuration = value;
                },
                disableAutoFocus: true,
              }),
              menu.action({
                name: 'Open editing window',
                select: () => this.setMemberEditing(this.memberEditDuration),
              }),
              menu.action({
                name: 'Close editing window',
                hide: () => !this.memberWindowOpen$.value,
                select: () => this.setMemberEditing(null),
              }),
            ],
          },
        }),
        menu.group({
          items: [
            menu.action({
              prefix: DeleteIcon(),
              class: {
                'delete-item': true,
              },
              name: 'Delete Database',
              hide: () => this.dataSource.value.readonly$.value,
              select: () => {
                if (this.dataSource.value.readonly$.value) return;
                this.model.children.slice().forEach(block => {
                  this.store.deleteBlock(block);
                });
                this.store.deleteBlock(this.model);
              },
            }),
          ],
        }),
      ],
    });

    popMenu(popupTargetFromElement(e.currentTarget as HTMLElement), {
      options,
    });
  };

  private readonly dataSource = lazy(() => {
    const currentUserId$ = computed(
      () =>
        this.std.getOptional(UserProvider)?.currentUserInfo$.value?.id ??
        getLocalViewerId()
    );
    const dataSource = new DatabaseBlockDataSource(
      this.model,
      dataSource => {
        dataSource.serviceSet(EditorHostKey, this.host);
        this.std.provider
          .getAll(ExternalGroupByConfigProvider)
          .forEach(config => {
            dataSource.serviceSet(
              ExternalGroupByConfigProvider(config.name),
              config
            );
          });
        this.std.provider
          .getAll(CalendarExternalSourceProvider)
          .forEach(source => {
            dataSource.serviceSet(
              CalendarExternalSourceProvider(source.id),
              source
            );
          });
      },
      currentUserId$,
      this.canManage$
    );
    const id = currentViewStorage.getCurrentView(this.model.id);
    if (id && dataSource.viewManager.viewGet(id)) {
      dataSource.viewManager.setCurrentView(id);
    }
    return dataSource;
  });

  private readonly renderTitle = (dataViewLogic: DataViewUILogicBase) => {
    return html` <affine-database-title
      class="${databaseTitleStyles}"
      .titleText="${this.model.props.title}"
      .dataViewLogic="${dataViewLogic}"
    ></affine-database-title>`;
  };

  createTemplate = (
    data: {
      view: SingleView;
      rowId: string;
    },
    openDoc: (docId: string) => void
  ) => {
    return createRecordDetail({
      ...data,
      openDoc,
      detail: {
        header: uniMap(
          createUniComponentFromWebComponent(BlockRenderer),
          props => ({
            ...props,
            host: this.host,
          })
        ),
        note: uniMap(
          createUniComponentFromWebComponent(NoteRenderer),
          props => ({
            ...props,
            model: this.model,
            host: this.host,
          })
        ),
      },
    });
  };

  headerWidget: DataViewWidget = defineUniComponent(
    (props: DataViewWidgetProps) => {
      return html`
        <div class="${databaseHeaderContainerStyles}">
          <div class="${databaseTitleRowStyles}">
            ${this.renderTitle(props.dataViewLogic)} ${this.renderDatabaseOps()}
          </div>
          <div
            role="status"
            style="font-size: 12px; color: var(--affine-text-secondary-color); margin-bottom: 8px"
          >
            ${
              this.memberWindowOpen$.value
                ? `Member editing until ${new Date(this.model.props.memberEditUntil ?? 0).toLocaleString()}`
                : 'Members read-only'
            }
          </div>
          <div class="${databaseToolbarRowStyles} ${databaseHeaderBarStyles}">
            <div class="${databaseViewBarContainerStyles}">
              ${renderUniLit(widgetPresets.viewBar, {
                ...props,
                onChangeView: id => {
                  currentViewStorage.setCurrentView(this.blockId, id);
                },
              })}
            </div>
            ${renderUniLit(this.toolsWidget, props)}
          </div>
          ${renderUniLit(widgetPresets.quickSettingBar, props)}
        </div>
      `;
    }
  );

  indicator = new DropIndicator();

  onDrag = (evt: MouseEvent, id: string): (() => void) => {
    this.dataSource.value.permissionTime$.value = Date.now();
    if (this.dataSource.value.readonly$.value) return () => {};
    const result = getDropResult(evt);
    if (result && result.rect) {
      document.body.append(this.indicator);
      this.indicator.rect = Rect.fromLWTH(
        result.rect.left,
        result.rect.width,
        result.rect.top,
        result.rect.height
      );
      return () => {
        this.indicator.remove();
        this.dataSource.value.permissionTime$.value = Date.now();
        if (this.dataSource.value.readonly$.value) return;
        const model = this.store.getBlock(id)?.model;
        const target = result.modelState.model;
        let parent = this.store.getParent(target.id);
        const shouldInsertIn = result.placement === 'in';
        if (shouldInsertIn) {
          parent = target;
        }
        if (model && target && parent) {
          if (shouldInsertIn) {
            this.store.moveBlocks([model], parent);
          } else {
            this.store.moveBlocks(
              [model],
              parent,
              target,
              result.placement === 'before'
            );
          }
        }
      };
    }
    this.indicator.remove();
    return () => {};
  };

  private readonly setSelection = (
    selection: DataViewSelection | undefined
  ) => {
    if (selection) {
      getSelection()?.removeAllRanges();
    }
    this.selection.setGroup(
      'note',
      selection
        ? [
            new DatabaseSelection({
              blockId: this.blockId,
              viewSelection: selection,
            }),
          ]
        : []
    );
  };

  private readonly toolsWidget: DataViewWidget = widgetPresets.createTools({
    table: [
      widgetPresets.tools.filter,
      widgetPresets.tools.sort,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
    kanban: [
      widgetPresets.tools.filter,
      widgetPresets.tools.sort,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
    calendar: [
      widgetPresets.tools.filter,
      widgetPresets.tools.search,
      widgetPresets.tools.viewOptions,
      widgetPresets.tools.tableAddRow,
    ],
  });

  private readonly viewSelection$ = computed(() => {
    const databaseSelection = this.selection.value.find(
      (selection): selection is DatabaseSelection => {
        if (selection.blockId !== this.blockId) {
          return false;
        }
        return selection instanceof DatabaseSelection;
      }
    );
    return databaseSelection?.viewSelection;
  });

  private readonly virtualPadding$ = signal(0);
  private memberEditDuration = '15';

  get optionsConfig(): DatabaseViewExtensionOptions {
    return {
      configure: (_model, options) => options,
      ...this.std.getOptional(DatabaseConfigExtension.identifier),
    };
  }

  get isCommentHighlighted() {
    return (
      this.std
        .getOptional(BlockElementCommentManager)
        ?.isBlockCommentHighlighted(this.model) ?? false
    );
  }

  override get topContenteditableElement() {
    if (this.std.get(DocModeProvider).getEditorMode() === 'edgeless') {
      return this.closest<BlockComponent>(
        EDGELESS_TOP_CONTENTEDITABLE_SELECTOR
      );
    }
    return this.rootComponent;
  }

  private renderDatabaseOps() {
    return html` <button
      type="button"
      aria-label="Database options"
      data-testid="database-ops"
      class="${databaseOpsStyles}"
      @click="${this.clickDatabaseOps}"
    >
      ${MoreHorizontalIcon()}
    </button>`;
  }

  override connectedCallback() {
    super.connectedCallback();

    this.setAttribute(RANGE_SYNC_EXCLUDE_ATTR, 'true');
    this.classList.add(databaseBlockStyles);
    this.listenFullWidthChange();
    this.handleMobileEditing();
    this.disposables.addFromEvent(
      window,
      'keydown',
      e => {
        const path = e.composedPath();
        if (!path.includes(this.host)) return;
        if (
          !path.includes(this) &&
          !this.selection.value.some(
            selection => selection.blockId === this.blockId
          )
        )
          return;
        const source = this.dataSource.value;
        source.permissionTime$.value = Date.now();
        if (
          source.readonly$.value &&
          (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === 'z'
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
    this.disposables.add(
      effect(() => {
        const until = this.model.props.memberEditUntil$.value;
        const source = this.dataSource.value;
        let timer: number | undefined;
        const refresh = () => {
          const now = Date.now();
          source.permissionTime$.value = now;
          if (typeof until !== 'number' || !Number.isFinite(until)) return;
          const delay = until - now;
          if (delay > 0) {
            timer = window.setTimeout(refresh, Math.min(delay, 2_147_483_647));
          }
        };
        refresh();
        return () => clearTimeout(timer);
      })
    );
    this.disposables.addFromEvent(window, 'focus', () => {
      this.dataSource.value.permissionTime$.value = Date.now();
    });
  }

  listenFullWidthChange() {
    if (this.std.get(DocModeProvider).getEditorMode() === 'edgeless') {
      return;
    }
    this.disposables.add(
      autoUpdate(this.host, this, () => {
        const padding =
          this.getBoundingClientRect().left -
          this.host.getBoundingClientRect().left;
        this.virtualPadding$.value = Math.max(0, padding - 72);
      })
    );
  }

  handleMobileEditing() {
    if (!IS_MOBILE) return;

    let notifyClosed = true;
    const handler = () => {
      if (
        !this.std
          .get(FeatureFlagService)
          .getFlag('enable_mobile_database_editing')
      ) {
        const notification = this.std.getOptional(NotificationProvider);
        if (notification && notifyClosed) {
          notifyClosed = false;
          notification.notify({
            title: html`<div
              style=${styleMap({
                whiteSpace: 'wrap',
              })}
            >
              Mobile database editing is not supported yet. You can open it in
              experimental features, or edit it in desktop mode.
            </div>`,
            accent: 'warning',
            onClose: () => {
              notifyClosed = true;
            },
          });
        }
      }
    };

    this.disposables.addFromEvent(this, 'click', handler);
  }

  private readonly dataViewRootLogic = lazy(
    () =>
      new DataViewRootUILogic({
        virtualPadding$: this.virtualPadding$,
        bindHotkey: hotkeys => {
          return {
            dispose: this.host.event.bindHotkey(hotkeys, {
              blockId: this.topContenteditableElement?.blockId ?? this.blockId,
            }),
          };
        },
        handleEvent: (name, handler) => {
          return {
            dispose: this.host.event.add(name, handler, {
              blockId: this.blockId,
            }),
          };
        },
        selection$: this.viewSelection$,
        setSelection: this.setSelection,
        dataSource: this.dataSource.value,
        headerWidget: this.headerWidget,
        onDrag: this.onDrag,
        clipboard: this.std.clipboard,
        dnd: this.std.dnd,
        notification: {
          toast: message => {
            const notification = this.std.getOptional(NotificationProvider);
            if (notification) {
              notification.toast(message);
            } else {
              toast(this.host, message);
            }
          },
        },
        eventTrace: (key, params) => {
          const telemetryService = this.std.getOptional(TelemetryProvider);
          telemetryService?.track(key, {
            ...(params as TelemetryEventMap[typeof key]),
            blockId: this.blockId,
          });
        },
        detailPanelConfig: {
          openDetailPanel: (target, data) => {
            const peekViewService = this.std.getOptional(PeekViewProvider);
            if (peekViewService) {
              const openDoc = (docId: string) => {
                return peekViewService.peek({
                  docId,
                  databaseId: this.blockId,
                  databaseDocId: this.model.store.id,
                  databaseRowId: data.rowId,
                  target: this,
                });
              };
              const doc = getSingleDocIdFromText(
                this.model.store.getBlock(data.rowId)?.model?.text
              );
              if (doc) {
                return openDoc(doc);
              }
              const abort = new AbortController();
              return new Promise<void>(focusBack => {
                peekViewService
                  .peek(
                    {
                      target,
                      template: this.createTemplate(data, docId => {
                        // abort.abort();
                        openDoc(docId).then(focusBack).catch(focusBack);
                      }),
                    },
                    { abortSignal: abort.signal }
                  )
                  .then(focusBack)
                  .catch(focusBack);
              });
            } else {
              return popSideDetail(
                this.createTemplate(data, () => {
                  //
                })
              );
            }
          },
        },
      })
  );
  override renderBlock() {
    const widgets = html`${repeat(
      Object.entries(this.widgets),
      ([id]) => id,
      ([_, widget]) => widget
    )}`;

    return html`
      <div contenteditable="false" class="${databaseContentStyles}">
        ${this.dataViewRootLogic.value.render()} ${widgets}
      </div>
    `;
  }

  override accessor useZeroWidth = true;
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-database': DatabaseBlockComponent;
  }
}

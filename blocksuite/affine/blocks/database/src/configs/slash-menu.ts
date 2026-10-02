import { getSelectedModelsCommand } from '@blocksuite/affine-shared/commands';
import { TelemetryProvider } from '@blocksuite/affine-shared/services';
import { isInsideBlockByFlavour } from '@blocksuite/affine-shared/utils';
import { type SlashMenuConfig } from '@blocksuite/affine-widget-slash-menu';
import { viewPresets } from '@blocksuite/data-view/view-presets';
import {
  DatabaseKanbanViewIcon,
  DatabaseTableViewIcon,
  TodayIcon,
} from '@blocksuite/icons/lit';

import { insertDatabaseBlockCommand } from '../commands';
import { ProtectedTableApiProvider } from '../service';
import { KanbanViewTooltip, TableViewTooltip } from './tooltips';

export const databaseSlashMenuConfig: SlashMenuConfig = {
  disableWhen: ({ model }) => model.flavour === 'affine:database',
  items: [
    {
      name: 'Protected Task Table',
      description: 'Store task cells on the server with row and column access rules.',
      searchAlias: ['database', 'permissions', 'project'],
      icon: DatabaseTableViewIcon(),
      group: '7_Database@0',
      when: ({ model, std }) =>
        !!std.getOptional(ProtectedTableApiProvider) &&
        !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertDatabaseBlockCommand, {
            viewType: viewPresets.tableViewMeta.type,
            protectedTable: true,
            place: 'after',
            removeEmptyLine: true,
          })
          .run();
      },
    },
    {
      name: 'Table View',
      description: 'Display items in a table format.',
      searchAlias: ['database'],
      icon: DatabaseTableViewIcon(),
      tooltip: {
        figure: TableViewTooltip,
        caption: 'Table View',
      },
      group: '7_Database@0',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertDatabaseBlockCommand, {
            viewType: viewPresets.tableViewMeta.type,
            place: 'after',
            removeEmptyLine: true,
          })
          .pipe(({ insertedDatabaseBlockId }) => {
            if (insertedDatabaseBlockId) {
              const telemetry = std.getOptional(TelemetryProvider);
              telemetry?.track('BlockCreated', {
                blockType: 'affine:database',
              });
            }
          })
          .run();
      },
    },

    {
      name: 'Calendar View',
      description: 'Display items by date in a calendar.',
      searchAlias: ['database', 'calendar'],
      icon: TodayIcon(),
      group: '7_Database@1',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertDatabaseBlockCommand, {
            viewType: viewPresets.calendarViewMeta.type,
            place: 'after',
            removeEmptyLine: true,
          })
          .pipe(({ insertedDatabaseBlockId }) => {
            if (insertedDatabaseBlockId) {
              const telemetry = std.getOptional(TelemetryProvider);
              telemetry?.track('BlockCreated', {
                blockType: 'affine:database',
              });
            }
          })
          .run();
      },
    },

    {
      name: 'Kanban View',
      description: 'Visualize data in a dashboard.',
      searchAlias: ['database'],
      icon: DatabaseKanbanViewIcon(),
      tooltip: {
        figure: KanbanViewTooltip,
        caption: 'Kanban View',
      },
      group: '7_Database@2',
      when: ({ model }) =>
        !isInsideBlockByFlavour(model.store, model, 'affine:edgeless-text'),
      action: ({ std }) => {
        std.command
          .chain()
          .pipe(getSelectedModelsCommand)
          .pipe(insertDatabaseBlockCommand, {
            viewType: viewPresets.kanbanViewMeta.type,
            place: 'after',
            removeEmptyLine: true,
          })
          .pipe(({ insertedDatabaseBlockId }) => {
            if (insertedDatabaseBlockId) {
              const telemetry = std.getOptional(TelemetryProvider);
              telemetry?.track('BlockCreated', {
                blockType: 'affine:database',
              });
            }
          })
          .run();
      },
    },
  ],
};

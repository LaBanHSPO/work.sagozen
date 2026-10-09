import config from './ava.config.js';
export default {
  ...config,
  require: ['/Users/bwork/Documents/GitHub/work.sagozen/packages/backend/server/src/prelude.ts'],
  files: [
    'src/core/doc/__tests__/database-validation.spec.ts',
    'src/core/doc/__tests__/database-adapter.spec.ts',
    'src/core/doc/__tests__/workspace-deletion-validation.spec.ts',
    'src/core/sync/__tests__/doc-updates.spec.ts',
  ],
};

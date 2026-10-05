import '../prelude';

import { createTestingApp } from './utils/testing-app';

const app = await createTestingApp();
await app.signup({
  email: 'web-only-smoke@example.invalid',
  password: 'WebOnlySmoke123!',
});
await new Promise<void>((resolve, reject) => {
  app.getHttpServer().close((error?: Error) => (error ? reject(error) : resolve()));
});
await app.listen(3010);
console.log('WEB_ONLY_BACKEND_READY');
const cleanup = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

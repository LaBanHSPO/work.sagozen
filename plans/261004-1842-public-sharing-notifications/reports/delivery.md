# Public sharing delivery

Status: DONE_WITH_CONCERNS

Enabling “Anyone with the link” atomically records the actor/document in Member Activity and creates inbox notifications for active workspace owners/admins other than the actor. Existing notification hydration, document navigation, mark-read controls, and realtime unread count updates are reused. Repeated/concurrent publishing creates no duplicates. Unsharing and sharing again creates a new event.

## Validation

- `cargo check -p affine_server_native --tests --offline`: passed.
- Native `public_share_records_managers_once_per_transition`: passed against isolated PostgreSQL. Covers rollback, concurrent requests, active/inactive/non-admin recipients, actor exclusion, rejected requests, and resharing.
- `yarn workspace @affine/server-native build:debug`: passed; linker warned about large unwind metadata.
- GraphQL public-sharing and document resolver suites: 9 tests passed. Confirms regular member sharing, owner/admin inbox contents, Member Activity identities/document, duplicate suppression, mark-read, and existing access/missing-document behavior.
- Changed implementation/test oxlint: passed.
- Formatting and `git diff --check`: passed.
- New migration applied successfully to isolated PostgreSQL after backup. No application database migrated.

AVA's relative prelude paths initially resolved inside its cache directory. Integration tests used `/private/tmp/sagozen-share-ava.config.mjs` to resolve those paths absolutely and the repository's `tools/cli/register.js` loader via `NODE_OPTIONS`. No project runner changes or reduced assertions.

## Review

Verified native authorization obtains the workspace transaction lock before checking prior visibility. Share state, audit entry, and notifications commit/roll back together. Notification count refresh occurs after the native command commits. Recipients use existing canonical active workspace membership roles. Publishing permissions, public GraphQL mutation responses, and notification read controls retain their contracts; `DocPublished` is additive. Unrelated generated declaration reorderings were removed and existing optional input types preserved.

## Existing check failures

- Server typecheck: `models/protected-table.ts` Prisma transaction types lack protected table model delegates; no public-sharing type errors remain.
- Frontend typecheck: async database block callback, React module augmentation in tracking, missing `useI18n` in plans layout, and missing `useCallback` in open-in-app page.
- Member Activity lint: existing `void load(0)` triggers floating-promise rule. The same code exists at HEAD.
- AgentKit plan reindex cannot open its user-home SQLite index in the sandbox. Canonical project plan file records completion; index sync remains unavailable.

## Deployment and cleanup

Apply `20261004120000_doc_published_notification` after a database backup, then deploy the updated server, frontend, and native module together. No deployment or commit performed.

Stopped owned containers `sagozen-share-tests` (port 55432) and `sagozen-share-redis` (port 56379). Pre-migration test database backup retained at `/private/tmp/sagozen-before-share-tests.dump`. Existing user Redis untouched. Unrelated simultaneous workspace edits preserved.

## Unresolved questions

None. Broader repository check failures remain outside this request.

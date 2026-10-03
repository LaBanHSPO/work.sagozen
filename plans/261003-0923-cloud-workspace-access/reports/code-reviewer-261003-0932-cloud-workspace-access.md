# Cloud workspace access review

Status: DONE

Reviewed pending diff, access gate, desktop/mobile routes, auth session/store wiring, workspace providers, personal creation model, runtime quota loader, and member ownership transition. `git diff --check` passed. Full tests/typecheck remain owned by controller/testing agent; no claim that those gates passed.

## Re-review

All accepted fixes were re-read and `git diff --check` passed again. No unresolved actionable findings remain in the reviewed scope.

- The gate now constructs a router-relative return destination from `useLocation()` pathname/search/hash, matching the existing sign-in router callback.
- The gate passes its scoped server's base URL as a top-level `server` sign-in parameter, preserving native non-default-server selection.
- Creation permission query failures now render a visible `role="alert"` and Retry button. Retry increments `checkAttempt`, which re-runs the permission effect; aborted attempts cannot overwrite newer state.

## Final entry-point review

The recovery return-type finding is resolved: `recoverBackupWorkspace()` now explicitly returns `Promise<string | undefined>` while rejecting before native writes, preserving its existing caller contract. Its constructor retains the dependency signature using a non-property `_workspacesService` parameter, avoiding a newly unused private property.

The creation command no longer offers local import. The document import menu no longer offers dotaffinefile; its remaining dormant handler reaches the rejecting import-workspace dialog and cannot write files. The dialog has no native loadDBFile call, local registration, or navigation result. Backup recovery rejects before native calls; existing backup listing/deletion are unchanged. No additional local creation or navigation bypass was identified in those callers.

Controller reports all changed TypeScript passed oxlint with warnings denied and oxfmt, and four frontend suites passed 18 tests. This reviewer independently reran `git diff --check`; executable tests and formatting/lint were not duplicated.

## Confirmed scope

The requirement is “1 user can create only 1 personal workspace,” with an active administrator exception: an ordinary user cannot create another while currently owning a personal workspace. Existing ownership transfer contracts remain accepted and unchanged. Transfer allowing additional ownership is therefore not a finding against this creation-only scope.

## Verified boundaries

- Filtering local flavour providers removes local creation through the normal factory/list path, and repository opening rejects local metadata without deleting stored data.
- The access gate returns no workspace children once session status is unauthenticated. Published-document fallback paths remain outside the gate as directed.
- Administrator exemption checks activated `administrator` feature records.
- Personal creation takes a transaction-scoped PostgreSQL advisory lock before counting current active owner memberships. Nested model creation uses the established transaction-host pattern.
- Team determination uses existing `usesOwnerQuota` semantics, through the native runtime's separate pool/cache. It cannot see uncommitted Prisma mutations; current production resolver calls creation as its own transaction, so no concrete new bypass was established from this alone.

Unresolved questions: none on reviewed scope. Broad typecheck/backend executable validation remain owned by the controller/testing agent; this review does not claim those gates passed.

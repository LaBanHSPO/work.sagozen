# Personal workspace regression verification

## Summary

Added six database-backed model tests and updated the local-workspace config e2e expectation to false. Formatting and focused oxlint pass. Runtime suites cannot collect tests because the repository's macOS server-native artifact is missing.

## Coverage

- First creation succeeds with private visibility and an active owner; second rejects with ActionForbidden, without extra persisted workspaces.
- Three concurrent requests yield one success and two ActionForbidden failures; persisted workspace and ownership counts remain one.
- Active administrator can create multiple personal workspaces; revoking administrator removes the exemption.
- Three joined workspaces do not consume the user's personal allowance.
- Owned active team workspace does not consume the personal allowance.
- Deleting the owned personal workspace permits a replacement.
- Config e2e now asserts ServerFeature.LocalWorkspace is absent.

Fixtures use existing UserModel/WorkspaceModel and factories that persist actual member and team entitlement records. No runtime behavior is mocked.

## Validation

Passed:

```sh
yarn oxfmt --write packages/backend/server/src/__tests__/models/personal-workspace.spec.ts packages/backend/server/src/__tests__/e2e/config/resolver.spec.ts
yarn oxlint packages/backend/server/src/__tests__/models/personal-workspace.spec.ts packages/backend/server/src/__tests__/e2e/config/resolver.spec.ts
```

Blocked before collection:

```sh
yarn workspace @affine/server test src/__tests__/models/personal-workspace.spec.ts
yarn affine server test src/__tests__/models/personal-workspace.spec.ts
```

Both fail with ERR_MODULE_NOT_FOUND: AVA resolves `./src/prelude.ts` against `packages/backend/server/node_modules/.cache/ava/import-from-project.mjs`.

A temporary config at `/private/tmp/personal-workspace-ava.config.mjs` imports the unchanged repository AVA config and resolves only prelude paths absolutely. With the project's server register loader, both the model suite and config e2e suite advance past that issue, then exit before collection:

```text
Error: Cannot find module './server-native.arm64.node'
Require stack:
- packages/backend/native/index.js
```

No tests ran; no coverage measured. No services or background processes started.

## Source verification

`core/workspaces/resolvers/workspace.ts` createWorkspace calls `models.workspace.createPersonal(user.id)`. It requires `@CurrentUser()` and has no public decorator. Global `core/auth/guard.ts` rejects missing authenticated users with AuthenticationRequired.

## Recommendations

Build the real server-native macOS artifact through the documented workflow, then rerun the focused suites against the isolated test database. Address AVA 7 relative prelude resolution in the owning test configuration separately if the canonical test command must remain unchanged.

## Unresolved questions

None about the requested behavior. Runtime verification remains blocked by repository build prerequisites.

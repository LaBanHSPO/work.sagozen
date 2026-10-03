---
title: Cloud workspace access
status: in-progress
priority: P1
effort: medium
branch: canary
tags: [auth, workspace, frontend, backend]
created: 2026-10-03
---

# Cloud workspace access

Status: implementation delivered; verification remains incomplete.

Outcome: workspace access requires sign-in; users create or join cloud workspaces; ordinary users may create at most one currently owned personal workspace, administrators are exempt from that creation limit.

Constraints: preserve stored local data and existing cloud memberships; retain team workspace behavior; enforce creation limit server-side under concurrency. No schema or GraphQL signature changes.

Non-goals: deleting old workspaces, limiting joined workspaces, changing billing, imposing an ownership-transfer cap, requiring sign-in for published document links.

## Phases

| Phase                                                        | Status              | Evidence / remaining work                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove local creation/navigation and guard workspace routes  | Implementation done | Local workspace import command/file option removed; import dialog rejects local writes; local backup recovery disabled; local provider filtered; repository rejects local opening; desktop/mobile workspace routes use authenticated access gate; create dialog checks cloud creation permissions.                                                                                                                      |
| Enforce personal creation limit with administrator exemption | Implementation done | GraphQL creation delegates to createPersonal; transactional per-owner lock; joined and team workspaces excluded; active server administrators exempt.                                                                                                                                                                                                                                                                   |
| Test, review, and document behavior                          | In progress         | Four frontend suites: 18 tests passed (access gate, desktop/mobile sign-in, first-app-data). Changed-file lint/format and diff checks passed. Backend regression coverage added; runtime validation blocked. Policy documented in [server development guide](../../docs/developing-server.md#workspace-access-policy). Review recorded in [review report](reports/code-reviewer-261003-0932-cloud-workspace-access.md). |

All three phases reconciled here; this plan has no separate phase files. Implementation phases precede backend runtime verification and final delivery acceptance.

## Acceptance criteria

- Anonymous workspace routes prompt sign-in; published document links remain public.
- Local workspaces cannot be created or opened; existing local data is preserved.
- Signed-in users can create or join cloud workspaces through invitations.
- An existing owned personal workspace blocks further personal creation; active server administrators are exempt.
- Concurrent creation cannot bypass the limit; joined/team workspaces do not count; deleting the owned personal workspace permits replacement.

## Validation remaining

- Backend suite collection fails on AVA relative prelude resolution. Retrying with absolute prelude paths reaches missing `server-native.arm64.node`; no backend regression tests ran. See [test report](reports/tester-261003-0930-personal-workspace.md).
- Broader typecheck remains blocked by missing referenced `dist` outputs and outdated generated Prisma types.
- Build native/runtime prerequisites and refresh referenced/generated outputs, then rerun focused backend suites and typecheck before marking the plan completed.

Unresolved product questions: none.

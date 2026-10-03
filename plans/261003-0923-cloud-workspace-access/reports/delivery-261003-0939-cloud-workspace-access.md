# Delivery record

Implementation delivered; backend validation incomplete.

- Workspace app access requires sign-in to the selected server. Return routes preserve path, query, hash, and server. Sign-out unmounts workspace content.
- Local workspace providers/opening, creation selection, workspace-file imports, and local backup recovery are unavailable. Existing local data remains stored. Document imports into cloud workspaces remain available.
- Server GraphQL creation uses transactional per-user locking and rejects further creation while a non-admin owns a personal workspace. Active server admins exempt. Team ownership and joined workspaces excluded. Ownership-transfer contracts unchanged.
- Creation dialog checks ownership/admin status and shows the limit; permission-fetch failure offers Retry. Empty workspace navigation directs users to create or join through an invitation.
- Published document links remain public; this is the stated assumption after the optional clarification received no response.

Validation: 18 tests passed in four frontend suites. Changed TypeScript lint (`oxlint --deny-warnings`), formatting, and `git diff --check` passed. Review fixes applied for relative return URI, selected server preservation, creation preflight retry, and backup recovery return type.

Backend: six actual database regression tests added, but AVA fails resolving the existing relative prelude. Temporary absolute-prelude configuration proceeds to a missing `packages/backend/native/server-native.arm64.node`; no backend cases collected. Typecheck fails on missing referenced distribution outputs and outdated generated Prisma types. Do not claim runtime concurrency/admin tests passed.

No dev services started. No commits, deployment, schema migrations, or local-data deletion performed.

Remaining: restore native/generated build prerequisites, run backend regression suites and typecheck. Plan remains in-progress until those checks pass.

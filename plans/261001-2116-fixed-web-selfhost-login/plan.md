# Fixed web self-hosted login

Status: Complete. Focused verification and review passed.

Outcome: Browser login uses only https://work.computeruse.best/ with email and password.

Constraints: Preserve native app login flows and existing server/workspace identities. Keep unrelated workspace edits intact.

Non-goals: Deployment, native login changes, server authentication API changes.

## Execution

1. Restrict browser login to the fixed origin and remove cloud, server picker, and guest options.
2. Verify fixed-origin routing, password login, mobile browser behavior, and native compatibility.
3. Review changed login files and document browser development behavior.

## Acceptance criteria

- Browser server query parameters cannot select another login server.
- Browser login uses email/password and keeps existing captcha/error handling.
- Off-origin browser login navigates to the fixed origin before collecting credentials.
- Native login behavior is preserved.
- Focused tests and file lint/format checks pass.

## Verification

- 11 tests passed across the browser login and existing mobile dialog suites.
- Oxlint and Oxfmt passed for all touched code and documentation.
- Review found a missing mobile `redirect_uri` forwarding path; fixed and covered by a route/wrapper test. Re-review passed.
- Full web build reached compilation through the repository runner but is blocked by unrelated concurrent edits: `share-page.tsx:399` has an empty JSX conditional, plus child compilation failures. The workspace package build command also lacks the `affine` executable.
- Full workspace Oxlint is blocked by unrelated import ordering in `share-footer.tsx`; all files owned by this change pass lint.

---
title: Public sharing notifications
status: completed
priority: medium
effort: 1h
---

# Public sharing notifications

Status: completed; focused verification passed. Existing broader check failures are listed in the [delivery report](reports/delivery.md).

Outcome: enabling “Anyone with the link” records Member Activity and notifies active workspace owners/admins other than the actor.
Constraints: preserve publish permissions and responses; use existing inbox and audit storage; serialize repeated/concurrent requests.
Non-goals: email alerts, notifications for unsharing, changes to sharing permissions.

## Implementation

- Add a DocPublished notification enum migration and generated client contract.
- In the native publish transaction, detect private-to-public transitions and persist actor/document audit details and manager notifications atomically.
- Refresh recipient unread counts after commit; render the notification and activity description.
- Document behavior and verify successful, rejected, repeated, concurrent, and republished shares.

## Acceptance

- A successful new public share creates one activity entry identifying actor and document.
- Active owner/admin recipients receive an inbox notification with document navigation; actor and other members do not.
- Repeated/concurrent publishing creates no duplicate records; unsharing then resharing creates a new event.
- Failed/unauthorized sharing leaves no records.
- Focused tests, formatting, lint, and relevant type/build checks pass, or environment limitations are reported explicitly.

## Review

Plan reviewed against existing native transaction/permission locks, notification hydration/realtime count patterns, and member audit UI. No changes to existing mutation inputs or response fields. Migration is additive; apply only after a database backup during deployment.

## Verification

- Native sharing transaction regression: passed (rollback, concurrency, recipients, rejected requests, resharing).
- GraphQL sharing and document resolver suites: 9 tests passed.
- Native compile and debug build: passed; linker emitted a large unwind metadata warning.
- Changed implementation/test lint and formatting: passed. Existing Member Activity floating-promise lint remains unchanged.
- Full server/frontend typechecks: blocked by unrelated existing errors; details in delivery report.
- Temporary database and Redis stopped; no user services or databases changed.

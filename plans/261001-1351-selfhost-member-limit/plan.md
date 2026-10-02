# Self-hosted workspace member limit

Status: in progress

Outcome: Free self-hosted workspaces allow 1,000 charged members or invitations and report the same limit in quota responses.

Constraints: Preserve cloud plan limits and licensed self-hosted Team seat quantities. Leave unrelated working-tree changes untouched.

Non-goals: Change subscription pricing, license validation, storage quotas, or cloud plans.

Acceptance: The free self-hosted grant resolves to 1,000 seats; quota reads and seat enforcement use it; focused Rust checks pass.

Phase: [Update self-hosted entitlement boundary](phase-01-entitlement-boundary.md).

# Update self-hosted entitlement boundary

Context: `affine_core` 0.0.5 supplies the 10-seat `selfhost_free` grant. This repo resolves grants in `packages/backend/native/src/entitlement.rs` and `packages/backend/native/src/runtime/backend_runtime/entitlement/mod.rs`.

Requirements: Set free self-hosted grants to 1,000 seats throughout quota and permission paths. Keep cloud and signed-license quantities intact.

Files: Native entitlement and runtime resolution code, focused tests, and any directly affected self-hosted documentation.

Steps: Add one local grant adjustment helper, call it at entitlement resolution boundaries, and cover free self-hosted and licensed quantities.

Validation: Focused Rust tests, formatting, and relevant static checks.

Risk and rollback: A missed resolution path could still expose 10 seats; remove the local adjustment to restore the upstream default.

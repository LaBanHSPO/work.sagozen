# Self-host build time

Status: complete

Outcome: reduce Rust build critical-path time and preserve native reuse for
JavaScript edits. Keep release optimization, generated N-API bindings, licensing
key injection, runtime layout, and both supported deployment architectures.

Constraints: existing Yarn lockfile and pinned Rust toolchain; no running service
changes. Non-goals: removing runtime features or changing global Cargo profiles.

## Phases

1. [Build stages and validation](phase-01-build-stages.md)

## Acceptance criteria

- Native dependencies and Rust toolchain can build independently of app installs.
- Cross-crate LTO and Cargo jobs are configurable for self-host builds.
- Compiled artifacts survive outside cache mounts and override host artifacts.
- Docker checks, focused native build/load, and a repeated cached build pass.
- Build workflow and cold-build limitations are documented.

Validation: Docker checks and Compose validation passed. Full ARM64 image build,
native addon smoke checks, and repeated cached build passed. See phase file for
timings and validation limits; no VPS or amd64 runtime benchmark was performed.

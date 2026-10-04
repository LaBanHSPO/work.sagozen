# Build stages and validation

Context: [Dockerfile](../../.docker/selfhost/Dockerfile),
[server guide](../../docs/developing-server.md).

Reported native step: 5,590 seconds of 5,853 seconds elapsed. Existing Dockerfile
already uses thin LTO, 16 codegen units, and persistent Cargo caches. Local Docker
is arm64, 10 CPUs, approximately 8 GiB. User's build host: Ubuntu 24.04.4,
x86_64 AMD EPYC, 4 CPUs, 7.8 GiB RAM, 4.1 GiB available during inspection.

## Implementation

- Split native-only Yarn dependencies, pinned Rust toolchain, and native compile.
- Preserve locked dependency versions and generated JS/types.
- Default self-host LTO to Cargo's regular release setting; retain opt-level 3.
- Expose LTO, codegen units, and Cargo jobs as build arguments, default jobs to
  two to leave RAM for services on the user's VPS.
- Scope compiled target cache by architecture and copy native output after source.
- Document one shared image build and native builder/memory/cache considerations.

Files: `.docker/selfhost/Dockerfile`, `docs/developing-server.md`.

## Validation

- Docker build checks and Compose configuration.
- Native image build and Node addon load/key/export smoke test.
- Repeat native build to establish layer-cache reuse.
- Review contracts and full image build when resources permit.

## Risks and rollback

Default LTO change can affect runtime performance; opt back in with
`--build-arg CARGO_LTO=thin`. New target cache IDs require one cold build.
Revert the Dockerfile/doc diff to restore the original build graph; caches and
runtime services need no cleanup or changes.

## Results

- Docker build checks: no warnings. Compose configuration and `git diff --check`
  passed. Focused Markdown format checks passed.
- Native-only Yarn install: 7.1 seconds, 34 packages (15.78 MiB).
- Fresh native target compile, warm download caches, local ARM64, four jobs:
  6m 08s Cargo compile, 7m 41s entire native-stage image build.
- Complete image with final two-job default: 5m 23s, including 3m 04s native crate
  recompile with dependency artifacts already cached and 65.3s app build.
- Repeated unchanged complete image: 5.7 seconds, Rust/app/dependency layers cached.
- Standalone native-stage rerun with two jobs: Cargo reused artifacts in 0.63s.
- Both four-job and final two-job addons loaded successfully in disposable,
  network-disabled containers. Checked public key parsing, BackendRuntime/export
  presence, merging a valid update, and valid/invalid document decoding.
- Read-only code review: no blocking regressions; broader package manifest edits
  still rerun native dependency focus. Ordinary frontend source edits retain it.
- Final-image runtime-file smoke command was blocked by local tool-access rules
  for `dist`; no runtime-file smoke or DB-backed server startup was performed.
- Build history IDs: `lhm841gj3nmb5qrlibq4ocv03` (native four-job compile),
  `5ffap7twnuqslg0n2xtxz4le7` (complete image),
  `uozv27zevuik3ogo6lizk25wc` (cached complete image).
- Validation tags: `affine-native-build:validation`,
  `affine:selfhost-build-validation`. No deployment or production tag changes.
  All started builds, log followers, and disposable containers finished.

Limits: local ARM64 timings do not establish VPS x86_64 improvement. New
architecture-specific target cache requires a first full compile on that VPS.
Cross-crate LTO changes can affect runtime performance; no runtime benchmark was
performed. Existing Yarn peer/patch and frontend bundle-size warnings remain.

Unresolved questions: none for implementation; VPS build duration remains unmeasured.

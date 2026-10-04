# syntax=docker/dockerfile:1.7

# Compiles this checkout, then packages the same runtime layout as the
# published AFFiNE image: server dist, production node_modules, and static apps.
#
# Rust and JavaScript builds have independent dependency stages. A frontend
# edit reuses the native build. Release optimization stays enabled; cross-crate
# LTO is optional to keep native linking inexpensive for local self-host builds.

ARG NATIVE_SOURCE=build

FROM node:22-bookworm AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    clang \
    cmake \
    curl \
    git \
    libssl-dev \
    openssl \
    pkg-config \
    python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Package manifests only. Application source is copied after install.
FROM base AS manifests

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases .yarn/releases
COPY .yarn/patches .yarn/patches
# One file per instruction. This builder does not support COPY --parents.
COPY blocksuite/affine/all/package.json blocksuite/affine/all/
COPY blocksuite/affine/blocks/attachment/package.json blocksuite/affine/blocks/attachment/
COPY blocksuite/affine/blocks/bookmark/package.json blocksuite/affine/blocks/bookmark/
COPY blocksuite/affine/blocks/callout/package.json blocksuite/affine/blocks/callout/
COPY blocksuite/affine/blocks/code/package.json blocksuite/affine/blocks/code/
COPY blocksuite/affine/blocks/data-view/package.json blocksuite/affine/blocks/data-view/
COPY blocksuite/affine/blocks/database/package.json blocksuite/affine/blocks/database/
COPY blocksuite/affine/blocks/divider/package.json blocksuite/affine/blocks/divider/
COPY blocksuite/affine/blocks/edgeless-text/package.json blocksuite/affine/blocks/edgeless-text/
COPY blocksuite/affine/blocks/embed-doc/package.json blocksuite/affine/blocks/embed-doc/
COPY blocksuite/affine/blocks/embed/package.json blocksuite/affine/blocks/embed/
COPY blocksuite/affine/blocks/frame/package.json blocksuite/affine/blocks/frame/
COPY blocksuite/affine/blocks/image/package.json blocksuite/affine/blocks/image/
COPY blocksuite/affine/blocks/latex/package.json blocksuite/affine/blocks/latex/
COPY blocksuite/affine/blocks/list/package.json blocksuite/affine/blocks/list/
COPY blocksuite/affine/blocks/note/package.json blocksuite/affine/blocks/note/
COPY blocksuite/affine/blocks/paragraph/package.json blocksuite/affine/blocks/paragraph/
COPY blocksuite/affine/blocks/root/package.json blocksuite/affine/blocks/root/
COPY blocksuite/affine/blocks/surface-ref/package.json blocksuite/affine/blocks/surface-ref/
COPY blocksuite/affine/blocks/surface/package.json blocksuite/affine/blocks/surface/
COPY blocksuite/affine/blocks/table/package.json blocksuite/affine/blocks/table/
COPY blocksuite/affine/components/package.json blocksuite/affine/components/
COPY blocksuite/affine/data-view/package.json blocksuite/affine/data-view/
COPY blocksuite/affine/ext-loader/package.json blocksuite/affine/ext-loader/
COPY blocksuite/affine/foundation/package.json blocksuite/affine/foundation/
COPY blocksuite/affine/fragments/adapter-panel/package.json blocksuite/affine/fragments/adapter-panel/
COPY blocksuite/affine/fragments/doc-title/package.json blocksuite/affine/fragments/doc-title/
COPY blocksuite/affine/fragments/frame-panel/package.json blocksuite/affine/fragments/frame-panel/
COPY blocksuite/affine/fragments/outline/package.json blocksuite/affine/fragments/outline/
COPY blocksuite/affine/gfx/brush/package.json blocksuite/affine/gfx/brush/
COPY blocksuite/affine/gfx/connector/package.json blocksuite/affine/gfx/connector/
COPY blocksuite/affine/gfx/group/package.json blocksuite/affine/gfx/group/
COPY blocksuite/affine/gfx/link/package.json blocksuite/affine/gfx/link/
COPY blocksuite/affine/gfx/mindmap/package.json blocksuite/affine/gfx/mindmap/
COPY blocksuite/affine/gfx/note/package.json blocksuite/affine/gfx/note/
COPY blocksuite/affine/gfx/pointer/package.json blocksuite/affine/gfx/pointer/
COPY blocksuite/affine/gfx/shape/package.json blocksuite/affine/gfx/shape/
COPY blocksuite/affine/gfx/template/package.json blocksuite/affine/gfx/template/
COPY blocksuite/affine/gfx/text/package.json blocksuite/affine/gfx/text/
COPY blocksuite/affine/gfx/turbo-renderer/package.json blocksuite/affine/gfx/turbo-renderer/
COPY blocksuite/affine/inlines/comment/package.json blocksuite/affine/inlines/comment/
COPY blocksuite/affine/inlines/footnote/package.json blocksuite/affine/inlines/footnote/
COPY blocksuite/affine/inlines/latex/package.json blocksuite/affine/inlines/latex/
COPY blocksuite/affine/inlines/link/package.json blocksuite/affine/inlines/link/
COPY blocksuite/affine/inlines/mention/package.json blocksuite/affine/inlines/mention/
COPY blocksuite/affine/inlines/preset/package.json blocksuite/affine/inlines/preset/
COPY blocksuite/affine/inlines/reference/package.json blocksuite/affine/inlines/reference/
COPY blocksuite/affine/model/package.json blocksuite/affine/model/
COPY blocksuite/affine/rich-text/package.json blocksuite/affine/rich-text/
COPY blocksuite/affine/shared/package.json blocksuite/affine/shared/
COPY blocksuite/affine/widgets/drag-handle/package.json blocksuite/affine/widgets/drag-handle/
COPY blocksuite/affine/widgets/edgeless-auto-connect/package.json blocksuite/affine/widgets/edgeless-auto-connect/
COPY blocksuite/affine/widgets/edgeless-dragging-area/package.json blocksuite/affine/widgets/edgeless-dragging-area/
COPY blocksuite/affine/widgets/edgeless-selected-rect/package.json blocksuite/affine/widgets/edgeless-selected-rect/
COPY blocksuite/affine/widgets/edgeless-toolbar/package.json blocksuite/affine/widgets/edgeless-toolbar/
COPY blocksuite/affine/widgets/edgeless-zoom-toolbar/package.json blocksuite/affine/widgets/edgeless-zoom-toolbar/
COPY blocksuite/affine/widgets/frame-title/package.json blocksuite/affine/widgets/frame-title/
COPY blocksuite/affine/widgets/keyboard-toolbar/package.json blocksuite/affine/widgets/keyboard-toolbar/
COPY blocksuite/affine/widgets/linked-doc/package.json blocksuite/affine/widgets/linked-doc/
COPY blocksuite/affine/widgets/note-slicer/package.json blocksuite/affine/widgets/note-slicer/
COPY blocksuite/affine/widgets/page-dragging-area/package.json blocksuite/affine/widgets/page-dragging-area/
COPY blocksuite/affine/widgets/remote-selection/package.json blocksuite/affine/widgets/remote-selection/
COPY blocksuite/affine/widgets/scroll-anchoring/package.json blocksuite/affine/widgets/scroll-anchoring/
COPY blocksuite/affine/widgets/slash-menu/package.json blocksuite/affine/widgets/slash-menu/
COPY blocksuite/affine/widgets/toolbar/package.json blocksuite/affine/widgets/toolbar/
COPY blocksuite/affine/widgets/viewport-overlay/package.json blocksuite/affine/widgets/viewport-overlay/
COPY blocksuite/docs-site/package.json blocksuite/docs-site/
COPY blocksuite/docs/package.json blocksuite/docs/
COPY blocksuite/framework/global/package.json blocksuite/framework/global/
COPY blocksuite/framework/std/package.json blocksuite/framework/std/
COPY blocksuite/framework/store/package.json blocksuite/framework/store/
COPY blocksuite/framework/sync/package.json blocksuite/framework/sync/
COPY blocksuite/integration-test/package.json blocksuite/integration-test/
COPY blocksuite/playground/package.json blocksuite/playground/
COPY docs/reference/package.json docs/reference/
COPY packages/backend/native/package.json packages/backend/native/
COPY packages/backend/server/package.json packages/backend/server/
COPY packages/common/auth/package.json packages/common/auth/
COPY packages/common/debug/package.json packages/common/debug/
COPY packages/common/env/package.json packages/common/env/
COPY packages/common/error/package.json packages/common/error/
COPY packages/common/graphql/package.json packages/common/graphql/
COPY packages/common/infra/package.json packages/common/infra/
COPY packages/common/nbstore/package.json packages/common/nbstore/
COPY packages/common/reader/package.json packages/common/reader/
COPY packages/common/realtime/package.json packages/common/realtime/
COPY packages/common/s3-compat/package.json packages/common/s3-compat/
COPY packages/frontend/admin/package.json packages/frontend/admin/
COPY packages/frontend/apps/android/package.json packages/frontend/apps/android/
COPY packages/frontend/apps/electron-renderer/package.json packages/frontend/apps/electron-renderer/
COPY packages/frontend/apps/electron/package.json packages/frontend/apps/electron/
COPY packages/frontend/apps/electron/scripts/package.json packages/frontend/apps/electron/scripts/
COPY packages/frontend/apps/ios/package.json packages/frontend/apps/ios/
COPY packages/frontend/apps/mobile-shared/package.json packages/frontend/apps/mobile-shared/
COPY packages/frontend/apps/mobile/package.json packages/frontend/apps/mobile/
COPY packages/frontend/apps/web/package.json packages/frontend/apps/web/
COPY packages/frontend/component/package.json packages/frontend/component/
COPY packages/frontend/core/package.json packages/frontend/core/
COPY packages/frontend/electron-api/package.json packages/frontend/electron-api/
COPY packages/frontend/i18n/package.json packages/frontend/i18n/
COPY packages/frontend/native/package.json packages/frontend/native/
COPY packages/frontend/routes/package.json packages/frontend/routes/
COPY packages/frontend/templates/package.json packages/frontend/templates/
COPY packages/frontend/track/package.json packages/frontend/track/
COPY tests/affine-cloud-copilot/package.json tests/affine-cloud-copilot/
COPY tests/affine-cloud/package.json tests/affine-cloud/
COPY tests/affine-desktop-cloud/package.json tests/affine-desktop-cloud/
COPY tests/affine-desktop/package.json tests/affine-desktop/
COPY tests/affine-local/package.json tests/affine-local/
COPY tests/affine-mobile/package.json tests/affine-mobile/
COPY tests/blocksuite/package.json tests/blocksuite/
COPY tests/kit/package.json tests/kit/
COPY tools/@types/assets/package.json tools/@types/assets/
COPY tools/@types/build-config/package.json tools/@types/build-config/
COPY tools/@types/env/package.json tools/@types/env/
COPY tools/changelog/package.json tools/changelog/
COPY tools/cli/package.json tools/cli/
COPY tools/commitlint/package.json tools/commitlint/
COPY tools/copilot-result/package.json tools/copilot-result/
COPY tools/doc-diff/package.json tools/doc-diff/
COPY tools/playstore-auto-bump/package.json tools/playstore-auto-bump/
COPY tools/revert-update/package.json tools/revert-update/
COPY tools/utils/package.json tools/utils/
COPY packages/backend/server/schema.prisma packages/backend/server/schema.prisma

# These postinstalls need the full source tree. Dependency install scripts
# (prisma, esbuild, swc) still run.
RUN node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';

for (const file of [
  'package.json',
  'packages/frontend/templates/package.json',
]) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.scripts) delete pkg.scripts.postinstall;
  writeFileSync(file, JSON.stringify(pkg));
}
EOF

FROM manifests AS deps

ENV HUSKY=0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    SENTRYCLI_SKIP_DOWNLOAD=1

RUN --mount=type=cache,id=affine-yarn,target=/root/.yarn/berry/cache,sharing=locked \
    corepack enable \
 && yarn config set enableScripts true \
 && yarn workspaces focus \
      @affine/server \
      @affine/web \
      @affine/admin \
      @affine/server-native \
      @affine-tools/cli

FROM manifests AS prod-deps

ENV HUSKY=0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    SENTRYCLI_SKIP_DOWNLOAD=1

RUN --mount=type=cache,id=affine-yarn,target=/root/.yarn/berry/cache,sharing=locked \
    corepack enable \
 && yarn config set enableScripts true \
 && yarn workspaces focus @affine/server --production \
 && yarn workspace @affine/server prisma generate

FROM manifests AS native-deps

ENV HUSKY=0

RUN --mount=type=cache,id=affine-yarn,target=/root/.yarn/berry/cache,sharing=locked \
    corepack enable \
 && yarn workspaces focus @affine/server-native

FROM base AS rust-toolchain

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain none --profile minimal

COPY rust-toolchain.toml ./
RUN rustup toolchain install "$(sed -n 's/^channel = "\(.*\)"/\1/p' rust-toolchain.toml)" \
      --profile minimal --no-self-update \
 && rustup default "$(sed -n 's/^channel = "\(.*\)"/\1/p' rust-toolchain.toml)"

FROM rust-toolchain AS native-build

COPY --from=native-deps /src/node_modules /src/node_modules
COPY Cargo.toml Cargo.lock ./
COPY .cargo/config.toml .cargo/config.toml
COPY packages/backend/native packages/backend/native
COPY packages/common/native packages/common/native
# Cargo resolves every workspace member's manifest, but napi builds only
# packages/backend/native and its dependencies, not desktop or mobile apps.
COPY packages/frontend/native packages/frontend/native
COPY packages/frontend/mobile-native packages/frontend/mobile-native

# Debug builds embed this key. Release builds need it too, or self-host
# refuses to start. Override with --build-arg AFFINE_PRO_PUBLIC_KEY.
RUN cat > /tmp/affine-pro-public-key.pem <<'EOF'
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEObwJiTmbui7rkWfPJ7Lozvuy2Rcl
otcrb0V6dlS2ijKEShm7ZttTwQn08xzesdjX/AxpoR5X9yfoHkauIBuuMQ==
-----END PUBLIC KEY-----
EOF

ARG AFFINE_PRO_PUBLIC_KEY
ARG TARGETARCH
ARG TARGETVARIANT
# Match Cargo's normal release defaults. Use CARGO_LTO=thin for cross-crate LTO.
ARG CARGO_LTO=false
ARG CARGO_CODEGEN_UNITS=16
# Leave RAM for the running self-hosted services on small builders.
# Override on larger builders, or pass an empty value for Cargo's CPU default.
ARG CARGO_BUILD_JOBS=2
RUN --mount=type=cache,id=affine-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=affine-cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=affine-cargo-target-${TARGETARCH}${TARGETVARIANT},target=/src/target,sharing=locked \
    arch="$(dpkg --print-architecture)" \
 && if [ "$arch" = "arm64" ]; then \
      export CC="clang -D_BSD_SOURCE -DAT_HWCAP2=26"; \
    else \
      export CC="clang -D_BSD_SOURCE"; \
    fi \
 && export TARGET_CC="$CC" \
 && export AFFINE_PRO_PUBLIC_KEY="${AFFINE_PRO_PUBLIC_KEY:-$(cat /tmp/affine-pro-public-key.pem)}" \
 && export CARGO_PROFILE_RELEASE_LTO="$CARGO_LTO" \
 && export CARGO_PROFILE_RELEASE_CODEGEN_UNITS="$CARGO_CODEGEN_UNITS" \
 && if [ -z "$CARGO_BUILD_JOBS" ]; then unset CARGO_BUILD_JOBS; fi \
 && cd packages/backend/native \
 && /src/node_modules/.bin/napi build --release --strip --no-const-enum \
 && cd /src \
 && native=packages/backend/native/server-native.node \
 && cp "$native" packages/backend/native/server-native.x64.node \
 && cp "$native" packages/backend/native/server-native.arm64.node \
 && cp "$native" packages/backend/native/server-native.armv7.node

# Export only deployable bindings, rather than the Cargo target cache.
FROM scratch AS native-export
COPY --from=native-build /src/packages/backend/native/server-native*.node /
COPY --from=native-build /src/packages/backend/native/index.js /index.js
COPY --from=native-build /src/packages/backend/native/index.d.ts /index.d.ts

FROM base AS native-prebuilt
ARG TARGETARCH
COPY .docker/selfhost/native/${TARGETARCH}/ /src/packages/backend/native/
# Fail early for a binary compiled for another OS/architecture or missing exports.
RUN node -e "require('/src/packages/backend/native/server-native.node')"

FROM native-${NATIVE_SOURCE} AS native-selected

FROM deps AS build

COPY . .
# Copy last so host binaries and checked-in bindings cannot replace Linux output.
COPY --from=native-selected /src/packages/backend/native/ packages/backend/native/
RUN yarn workspace @affine/templates build

ENV BUILD_TYPE=stable
# .git is not in the build context. The web bundler reads GITHUB_SHA instead.
ARG SOURCE_SHA=selfhost
ENV GITHUB_SHA=${SOURCE_SHA}
# The server loads both manifests at startup. Serve the same web application
# to mobile browsers without compiling the separate mobile application.
RUN yarn workspace @affine/server build \
 && node tools/cli/bin/runner.js affine.ts @affine/web build \
 && node tools/cli/bin/runner.js affine.ts @affine/admin build \
 && mkdir -p packages/backend/server/static/admin packages/backend/server/static/mobile \
 && cp -a packages/frontend/apps/web/dist/. packages/backend/server/static/ \
 && cp -a packages/frontend/admin/dist/. packages/backend/server/static/admin/ \
 && cp -a packages/frontend/apps/web/dist/. packages/backend/server/static/mobile/

FROM node:22-bookworm-slim
WORKDIR /app

COPY --from=build /src/packages/backend/server /app
COPY --from=prod-deps /src/node_modules /app/node_modules

ARG TARGETARCH
ARG TARGETVARIANT
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libjemalloc2 \
    openssl \
 && rm -rf /var/lib/apt/lists/* \
 && AFFINE_DOCKER_CLEAN=1 \
    TARGETARCH="${TARGETARCH}" \
    TARGETVARIANT="${TARGETVARIANT}" \
    node ./scripts/docker-clean.mjs \
 && if [ ! -f ./dist/server-native.node ]; then \
      kept="$(find ./dist -maxdepth 1 -name 'server-native.*.node' -print -quit)"; \
      if [ -n "$kept" ]; then cp "$kept" ./dist/server-native.node; fi; \
    fi

ENV LD_PRELOAD=libjemalloc.so.2
EXPOSE 3010
CMD ["sh", "-c", "node ./scripts/upgrade-config.js && exec node ./dist/main.js"]

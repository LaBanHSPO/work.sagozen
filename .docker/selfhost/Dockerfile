# syntax=docker/dockerfile:1.7

# Compiles this checkout, then packages the same runtime layout as the
# published AFFiNE image: server dist, production node_modules, and static apps.
#
# Dependency install and the Rust compile are their own layers. A frontend
# edit reuses both. Rust uses thin LTO so a native rebuild is not a 30+ minute
# single-threaded link.

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
COPY --parents \
    blocksuite/*/package.json \
    blocksuite/*/*/package.json \
    blocksuite/*/*/*/package.json \
    docs/*/package.json \
    packages/*/*/package.json \
    packages/*/*/*/package.json \
    packages/*/*/*/*/package.json \
    tests/*/package.json \
    tools/*/package.json \
    tools/*/*/package.json \
    ./
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
      @affine/mobile \
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

FROM deps AS build

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH \
    CARGO_PROFILE_RELEASE_LTO=thin \
    CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16

RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain none --profile minimal

COPY rust-toolchain.toml ./
RUN rustup toolchain install "$(sed -n 's/^channel = "\(.*\)"/\1/p' rust-toolchain.toml)" \
      --profile minimal --no-self-update \
 && rustup default "$(sed -n 's/^channel = "\(.*\)"/\1/p' rust-toolchain.toml)"

COPY Cargo.toml Cargo.lock ./
COPY .cargo/config.toml .cargo/config.toml
COPY packages/backend/native packages/backend/native
COPY packages/common/native packages/common/native
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
RUN --mount=type=cache,id=affine-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=affine-cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=affine-cargo-target,target=/src/target,sharing=locked \
    arch="$(dpkg --print-architecture)" \
 && if [ "$arch" = "arm64" ]; then \
      export CC="clang -D_BSD_SOURCE -DAT_HWCAP2=26"; \
    else \
      export CC="clang -D_BSD_SOURCE"; \
    fi \
 && export TARGET_CC="$CC" \
 && export AFFINE_PRO_PUBLIC_KEY="${AFFINE_PRO_PUBLIC_KEY:-$(cat /tmp/affine-pro-public-key.pem)}" \
 && yarn workspace @affine/server-native build \
 && native=packages/backend/native/server-native.node \
 && cp "$native" packages/backend/native/server-native.x64.node \
 && cp "$native" packages/backend/native/server-native.arm64.node \
 && cp "$native" packages/backend/native/server-native.armv7.node

COPY . .

ENV BUILD_TYPE=stable
# .git is not in the build context. The web bundler reads GITHUB_SHA instead.
ARG SOURCE_SHA=selfhost
ENV GITHUB_SHA=${SOURCE_SHA}
RUN yarn workspace @affine/server build \
 && yarn affine @affine/web build \
 && yarn affine @affine/admin build \
 && yarn affine @affine/mobile build \
 && mkdir -p packages/backend/server/static/admin packages/backend/server/static/mobile \
 && cp -a packages/frontend/apps/web/dist/. packages/backend/server/static/ \
 && cp -a packages/frontend/admin/dist/. packages/backend/server/static/admin/ \
 && cp -a packages/frontend/apps/mobile/dist/. packages/backend/server/static/mobile/

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

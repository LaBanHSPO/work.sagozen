# syntax=docker/dockerfile:1.7

# Compiles this checkout, then packages the same runtime layout as the
# published AFFiNE image: server dist, production node_modules, and static apps.

FROM node:22-bookworm AS build

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

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain none --profile minimal

WORKDIR /src
COPY . .

RUN corepack enable \
 && yarn config set enableScripts true \
 && HUSKY=0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    SENTRYCLI_SKIP_DOWNLOAD=1 \
    yarn install --immutable

# Debug builds embed this key. Release builds need it too, or self-host
# refuses to start. Override with --build-arg AFFINE_PRO_PUBLIC_KEY.
RUN cat > /tmp/affine-pro-public-key.pem <<'EOF'
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEObwJiTmbui7rkWfPJ7Lozvuy2Rcl
otcrb0V6dlS2ijKEShm7ZttTwQn08xzesdjX/AxpoR5X9yfoHkauIBuuMQ==
-----END PUBLIC KEY-----
EOF

ARG AFFINE_PRO_PUBLIC_KEY
ENV BUILD_TYPE=stable
RUN arch="$(dpkg --print-architecture)" \
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

# .git is not in the build context. The web bundler reads GITHUB_SHA instead.
ARG SOURCE_SHA=selfhost
ENV GITHUB_SHA=${SOURCE_SHA}
RUN yarn workspace @affine/server build \
 && yarn affine @affine/web build \
 && yarn affine @affine/admin build \
 && yarn affine @affine/mobile build

RUN rm -rf node_modules \
 && HUSKY=0 yarn workspaces focus @affine/server --production \
 && yarn workspace @affine/server prisma generate \
 && mv node_modules packages/backend/server/node_modules \
 && mkdir -p packages/backend/server/static/admin packages/backend/server/static/mobile \
 && cp -a packages/frontend/apps/web/dist/. packages/backend/server/static/ \
 && cp -a packages/frontend/admin/dist/. packages/backend/server/static/admin/ \
 && cp -a packages/frontend/apps/mobile/dist/. packages/backend/server/static/mobile/

FROM node:22-bookworm-slim
WORKDIR /app

COPY --from=build /src/packages/backend/server /app

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

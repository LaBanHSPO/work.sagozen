This document explains how to start server (@affine/server) locally with Docker

> **Warning**:
>
> This document is not guaranteed to be up-to-date.
> If you find any outdated information, please feel free to open an issue or submit a PR.

## Run required dev services in docker compose

Running yarn's server package (@affine/server) requires some dev services to be running, i.e.:

- postgres
- redis
- mailhog

You can run these services in docker compose by running the following command:

```sh
cp ./.docker/dev/compose.yml.example ./.docker/dev/compose.yml
cp ./.docker/dev/.env.example ./.docker/dev/.env

docker compose -f ./.docker/dev/compose.yml up
```

### Notify

> Starting from AFFiNE 0.20, compose.yml includes a breaking change: the default database image has switched from `postgres:16` to `pgvector/pgvector:pg16`. If you were previously using another major version of Postgres, please change the number after `pgvector/pgvector:pg` to the major version you are using.

## Build native packages (you need to setup rust toolchain first)

Server also requires native packages to be built, you can build them by running the following command:

```sh
# build native
yarn affine @affine/server-native build
```

## Build the self-hosted image from this checkout

From the repository root, build the shared server/migration image once:

```sh
docker compose -f .docker/selfhost/compose.yml build affine
docker compose -f .docker/selfhost/compose.yml up -d --no-build
```

The [self-host Dockerfile](../.docker/selfhost/Dockerfile) builds Rust separately
from the server and frontend JavaScript dependencies. Frontend source edits reuse
the native layer; Cargo's download and architecture-specific compilation caches
also survive native source edits on the same builder. Keep the builder cache
between builds. A new builder or a cache prune requires a cold compile again.

The native module uses release optimization with 16 codegen units and Cargo's
default release LTO setting (`false`, local thin LTO only). To restore cross-crate
thin LTO, pass `--build-arg CARGO_LTO=thin` to the build command. Changing this
setting recompiles the affected Rust artifacts; runtime performance may differ.

The default caps concurrent Rust compiler jobs at two to leave RAM for running
services on small builders such as a 4-core, 8 GiB VPS. On larger builders, raise
the limit, for example:

```sh
docker compose -f .docker/selfhost/compose.yml build --build-arg CARGO_BUILD_JOBS=4 affine
```

Pass `--build-arg CARGO_BUILD_JOBS=` to let Cargo choose concurrency from the
available CPUs. Build on the target CPU architecture when possible: compiling an
amd64 image under emulation on an
arm64 machine (or vice versa) can be much slower. For cross-architecture deployment,
use a native builder for that target. The first build still compiles the full Rust
dependency graph.

## Prepare dev environment

```sh
# uncomment all env variables here
cp packages/backend/server/.env.example packages/backend/server/.env

# everytime there are new migrations, init command should runned again
yarn affine server init
```

## Start server

```sh
# at project root
yarn affine server dev
```

when server started, it will created a default user and a pro user for testing:

### default user

Workspace members up to 3

- email: dev@affine.pro
- name: Dev User
- password: dev

### pro user

Workspace members up to 10

- email: pro@affine.pro
- name: Pro User
- password: pro

### team user

Include a default `Team Workspace` and the members up to 10

- email: team@affine.pro
- name: Team User
- password: team

## Start frontend

```sh
# at project root
yarn dev
```

You can login with the user (dev@affine.pro / dev) above to test the server.

## Workspace access policy

Workspace access requires sign-in. Users create cloud workspaces or join existing
workspaces through invitations. Local workspace creation and opening are disabled;
previously stored local data is preserved. Published document links remain public.

Creating a personal workspace is blocked while the user already owns a personal
workspace. Active server administrators are exempt. Joined workspaces and owned
team workspaces do not count toward this creation limit. Deleting the owned
personal workspace permits creating a replacement. The server serializes creation
per owner so concurrent requests cannot bypass the limit.

## Done

Now you should be able to start developing affine with server enabled.

## Bonus

### Self-hosted version history

The default self-hosted plan retains newly created document versions for 365
days. The history dialog displays the retention period from the workspace quota.
Self-hosted workspaces use the Pro history view, including while quota data loads,
and do not display the Free-plan upgrade prompt.
Cloud plans and licensed self-hosted Team plans retain their existing limits.
Rebuild and restart the self-hosted image after changing the native plan limits.
Existing versions keep their recorded expiration dates; deleted versions cannot
be recovered by increasing retention.

### Enable prisma studio (Database GUI)

```sh
# available at http://localhost:5555
yarn affine server prisma studio
```

### Seed the db

```sh
yarn affine server seed -h
```

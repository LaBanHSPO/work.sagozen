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

## Protected task table removal

The server-backed protected task table introduced in commit `71705ad` has been
removed, including its creation menus, REST endpoints, and row/column permission
rules. Ordinary database views, saved views, and document/workspace authorization
remain unchanged.

The historical `20261002000000_protected_tables` SQL migration is retained. This
removal does not drop tables or delete existing protected-table records. Their
server-backed cells are no longer available in the editor and are not converted
into ordinary document cells. Preserve the records for any future refactor; do
not generate or apply a destructive schema-diff migration as part of this rollback.

Rebuild the server and web assets before deploying; regenerate the Prisma client
from the current schema. The removed implementation remains recoverable from
commit `71705ad`.

## Build native packages (you need to setup rust toolchain first)

Server also requires native packages to be built, you can build them by running the following command:

```sh
# build native
yarn affine @affine/server-native build
```

## Build the self-hosted image from this checkout

The image builds the server, web application, and admin web interface. Every
browser receives the same web assets and manifest under `static/`; the admin
interface remains under `static/admin/`. There is no separate mobile build.

The Rust step builds `@affine/server-native`, a required Node module used by the
backend. Cargo contains only `packages/backend/native` and
`packages/common/native`; frontend native workspace copies are not needed.

From the repository root, build the shared server/migration image once:

```sh
docker compose -f .docker/selfhost/compose.yml build affine
docker compose -f .docker/selfhost/compose.yml up -d --no-build
```

### Reuse a local Linux Rust build

Build the native bindings once on your local Docker engine and save them in this
checkout. This works on macOS too: the compiler runs in Linux, so the exported
module is compatible with the Docker runtime.

```sh
sh .docker/selfhost/build-native.sh
NATIVE_SOURCE=prebuilt docker compose -f .docker/selfhost/compose.yml build affine
```

Artifacts live in `.docker/selfhost/native/arm64/` or
`.docker/selfhost/native/amd64/` and are ignored by Git. Keep them locally, or copy
the matching directory into the deployment checkout before building. The
prebuilt path skips the Rust toolchain and compilation stages entirely. It
checks that Node can load the module before building the application.

Rerun the script after changes to Rust sources, Cargo dependencies, the Rust
toolchain, native bindings, or the embedded public key. Prebuilt selection is
explicit and does not detect stale artifacts automatically. Missing or
incompatible binaries fail the build. The normal build remains available by
omitting `NATIVE_SOURCE=prebuilt`.

For another deployment architecture, select it explicitly (emulation can be slow):

```sh
sh .docker/selfhost/build-native.sh amd64 --build-arg CARGO_BUILD_JOBS=4
DOCKER_DEFAULT_PLATFORM=linux/amd64 NATIVE_SOURCE=prebuilt docker compose -f .docker/selfhost/compose.yml build affine
```

The script accepts the same Cargo and `AFFINE_PRO_PUBLIC_KEY` build arguments as
the Dockerfile. Set these when exporting; they do not change an already compiled
module during the prebuilt image build. The first export needs a full compilation;
later exports reuse the existing Docker Cargo caches.

### Deploy from macOS to the Ubuntu AMD64 VPS

The target VPS runs Ubuntu 24.04 on `x86_64`, with 4 CPU cores and about 8 GiB
RAM. Build Linux AMD64 Rust bindings on the Mac, then build the JavaScript apps
and image on the VPS. Docker Desktop must be running on the Mac; the VPS needs
Docker Engine with the Compose plugin. Run commands from the repository root
unless noted otherwise.

1. On the Mac, build the bindings for the VPS architecture:

   ```sh
   sh .docker/selfhost/build-native.sh amd64
   ```

   An Apple Silicon Mac uses emulation for this build, so the first compilation
   can be slow. The output is saved in `.docker/selfhost/native/amd64/`.

2. Put the same source revision on the VPS, including the updated Dockerfile,
   Compose file, and any Rust changes used for the export. Compare
   `git rev-parse HEAD` on both machines; also transfer any uncommitted changes
   needed for deployment. Git does not transfer the ignored native artifacts.

3. On the Mac, replace the SSH destination and absolute VPS checkout path below,
   then transfer the bindings:

   ```sh
   VPS_SSH=deploy@your-vps
   VPS_REPO=/srv/work.sagozen
   ssh "$VPS_SSH" "mkdir -p '$VPS_REPO/.docker/selfhost/native/amd64'"
   scp -r .docker/selfhost/native/amd64/. \
     "$VPS_SSH:$VPS_REPO/.docker/selfhost/native/amd64/"
   ```

4. On the VPS, build the shared server/migration image using the saved bindings:

   ```sh
   cd /srv/work.sagozen
   NATIVE_SOURCE=prebuilt docker compose -f .docker/selfhost/compose.yml build affine
   ```

   This skips Rust compilation. Server and frontend JavaScript still build on
   the VPS. Missing or incompatible native artifacts fail the build.

5. Before updating an existing deployment, back up its database and storage.
   For the running Compose database, save a database dump outside the image
   build context:

   ```sh
   mkdir -p "$HOME/affine-backups"
   docker compose -f .docker/selfhost/compose.yml exec -T postgres \
     pg_dump -U affine -d affine -Fc \
     > "$HOME/affine-backups/affine-$(date +%Y%m%d-%H%M%S).dump"
   ```

   Preserve `data/storage/` and `.docker/selfhost/config/` with your normal
   backup process. For a new deployment, configure the public URL and server
   settings in [Compose](../.docker/selfhost/compose.yml) and its mounted config
   directory before starting services.

6. On the VPS, start the deployment and check migration and server status:

   ```sh
   docker compose -f .docker/selfhost/compose.yml up -d --no-build
   docker compose -f .docker/selfhost/compose.yml ps -a
   docker compose -f .docker/selfhost/compose.yml logs --tail=100 affine_migration affine
   ```

   Startup runs the migration job before starting the server. Confirm that the
   migration job exits successfully and the application is reachable through
   the configured public URL. For an existing deployment, verify that the
   migration job ran for the new image.

Repeat the AMD64 export and transfer whenever Rust sources, Cargo dependencies,
the toolchain, generated native bindings, or the embedded public key change.
For JavaScript-only changes, reuse the saved AMD64 artifacts and repeat the VPS
image build and deployment steps. Keeping artifacts in the checkout avoids
depending on the VPS Rust build cache; they remain local files, not Git commits.

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

Enabling “Anyone with the link” records the actor and document in Member activity
and sends an inbox notification to active workspace owners and admins, excluding
the person sharing. The notification opens the document. Repeated publishing of
an already-public document does not create duplicate records; disabling the link
and enabling it again records a new share. Activity and notifications commit with
the publish operation, so rejected or failed shares leave no records.
Apply the `DocPublished` notification migration before running the updated server
and native module. Back up the database before applying migrations.

Creating a personal workspace is blocked while the user already owns a personal
workspace. Active server administrators are exempt. Joined workspaces and owned
team workspaces do not count toward this creation limit. Deleting the owned
personal workspace permits creating a replacement. The server serializes creation
per owner so concurrent requests cannot bypass the limit.

### Document member permissions

Workspace members inherit **Reader** access to documents: they can read, but
cannot edit unless an individual grant or a document rule allows it. Existing
individual grants still take precedence over the member default.

Open a document's **Share** panel and select **Edit member permissions JSON**.
Workspace owners, active workspace admins, and document owners can use this
editor. Admins do not need a commercial entitlement for this operation; existing
quota checks and unrelated entitlement restrictions still apply. Member rules
remain configurable when public sharing is disabled.

```json
{
  "defaultRole": "reader",
  "members": [
    { "userId": "workspace-member-id", "role": "editor" }
  ]
}
```

Use the workspace member's user ID, not an email address. `defaultRole` accepts
`none`, `reader`, `commenter`, `editor`, or `manager`. Individual member roles
accept `reader`, `commenter`, `editor`, or `manager`; `none` is not an individual
deny rule. A `none` default removes inherited member access, but does not override
ownership or individual grants, or change the document's public-link settings.

The JSON contains all active-member grants except ownership. Saving removes
omitted active non-owner grants, so those members inherit `defaultRole`. Ownership,
guest and inactive-member grants, group grants, and public-link settings are
preserved. Ownership transfers remain a separate operation.

Saves are atomic. Malformed rules, unauthorized edits, and stale workspace
permission revisions are rejected without partial changes. Failed saves keep the
draft; **Reload from server** explicitly discards it and loads the current rules.
An admin opening a restricted document can use the permission editor without
receiving ordinary document read access.

Before deployment, back up the database and apply
`20261005120000_reader_member_defaults`. This migration deliberately resets
**all existing workspace and document member defaults to Reader**, including
previous `none`, Editor, and Manager defaults. It preserves individual grants,
ownership, public sharing, and other policy fields. Deploy the updated native
module, server, and frontend together; the JSON requests require all three.

## Missing document updates during sync

Workspace sync acknowledges and discards updates when the document writer reports
`doc_not_found`. These stale updates are not retried, recreated, or broadcast to
other clients. The acknowledgement includes a timestamp so the client can clear
the pending update and continue syncing. Subscription and permission checks still
apply; other save failures remain errors.

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

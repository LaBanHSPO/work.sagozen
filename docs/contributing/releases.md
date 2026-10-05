## AFFiNE Release Process

> In order to make a stable/beta release, you need to get authorization from the AFFiNE test team.

## Who Can Make a Release?

The AFFiNE core team grants release authorization and enforces the following requirements:

- Commit access to the AFFiNE repository.
- Access to GitHub Actions.

## How to Make a Release

Before releasing, ensure you have the latest version of the `canary` branch and review the [SemVer](https://semver.org) specification to understand versioning.

### 1. Update the Version in `package.json`

```shell
./scripts/set-version.sh 0.5.4-canary.5
```

### 2. Commit Changes and Push to `canary`

```shell
git add .
# vX.Y.Z-canary.N
git commit -m "v0.5.4-canary.5"
git push origin canary
```

### 3. Build and Deploy the Self-hosted Release

Build the shared server/migration image from the release commit:

```shell
docker compose -f .docker/selfhost/compose.yml build
```

Follow [the self-hosted deployment guide](../developing-server.md) for environment
configuration, migrations, native binding exports, and deployment. The image
contains the server and the web/admin browser apps; every browser uses the same
web shell. No desktop installers or mobile store releases are produced.

Before publishing release notes, ensure the release tag and title match the
version in `package.json` and point to the deployed commit.

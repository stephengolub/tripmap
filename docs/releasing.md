# Releasing tripmap

The npm package `tripmap` is published by `.github/workflows/release.yml` when a version tag is
pushed. Auth is npm **trusted publishing** (OIDC): there is no `NPM_TOKEN` secret, and the
workflow gets a short-lived credential from GitHub that npm accepts for this repo and workflow
file only.

## One-time setup

npm can only attach a trusted publisher to a package that already exists, so the first version
is published by hand.

1. **Publish 1.0.0 manually** from your Mac (you are already logged in as `stephengolub`):

   ```sh
   cd ~/code/tripmap
   npm run build
   npm publish -w tripmap --access public
   ```

   Enter your one-time code when npm asks.

2. **Configure the trusted publisher** on npmjs.com: open
   `https://www.npmjs.com/package/tripmap/access`, find **Trusted publishing**, choose
   **GitHub Actions**, and enter exactly:

   | Field | Value |
   | --- | --- |
   | Organization or user | `stephengolub` |
   | Repository | `tripmap` |
   | Workflow filename | `release.yml` |
   | Environment | *(leave blank)* |

   The workflow filename is matched exactly, so keep the file name.

3. **Tag and release 1.0.0 by hand.** Do not push a `v1.0.0` tag and let the workflow run: it
   would try to publish 1.0.0 again, and npm refuses to overwrite a version.

   ```sh
   git tag v1.0.0 && git push origin v1.0.0
   gh release create v1.0.0 --title "tripmap v1.0.0" --generate-notes
   ```

   Pushing the tag starts the release workflow, so push it only after the trusted publisher is
   set. The workflow's publish job will fail on the existing version, which is expected for
   1.0.0. Skip the tag push and run `gh release create v1.0.0 --target <sha> --generate-notes`
   to avoid that failure.

4. **Optional hardening** on npmjs.com: under the package's publishing settings, require 2FA
   for publishing and disallow classic tokens, so a leaked token can't publish.

## Releasing a new version

1. Bump `version` in `packages/cli/package.json` (for example `1.0.1`) and commit it on `main`.
   CI must be green on that commit.
2. Tag it with the same version and push the tag:

   ```sh
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. The release workflow then runs three jobs:
   - **verify**: the tag must equal the package version, then typecheck, lint, unit tests, build,
     end-to-end tests, and the no-example-data check on the tarball.
   - **publish**: upgrades npm to 11.5.1 or newer (trusted publishing needs it), builds, and runs
     `npm publish -w tripmap --access public --provenance`.
   - **github-release**: creates the GitHub release for the tag with generated notes.

Nothing publishes unless verify passes. A tag that doesn't match the version stops the run before
any build.

## Checking a release

```sh
npm view tripmap version                       # the new version
npm view tripmap@1.0.1 dist.attestations       # provenance attestation is present
cd "$(mktemp -d)" && npx --yes tripmap@1.0.1 --version
```

## Troubleshooting

- **`ENEEDAUTH` or `404` on publish:** the trusted publisher is missing, or its repository,
  owner, or workflow filename doesn't match. Re-check the table above.
- **`npm: 10.x` in the logs:** the upgrade step didn't run. Trusted publishing fails on npm 10.
- **`cannot publish over the previously published versions`:** that version already exists. Bump
  the version; npm does not allow reuse.

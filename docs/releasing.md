# Releasing tripmap

The npm package `tripmap` is published by `.github/workflows/release.yml` when a version tag is
pushed. Auth is npm **trusted publishing** (OIDC): there is no `NPM_TOKEN` secret, and the
workflow gets a short-lived credential from GitHub that npm accepts for this repo and workflow
file only.

## One-time setup (done for 1.0.0)

1. **Publish 1.0.0 manually** from your Mac (done). npm can only attach a trusted publisher to a
   package that already exists, so the first version was published by hand.

2. **Trusted publisher, stage only.** On npmjs.com, open
   `https://www.npmjs.com/package/tripmap/access`, find **Trusted publishing**, and check that it
   matches:

   | Field | Value |
   | --- | --- |
   | Provider | GitHub Actions |
   | Organization or user | `stephengolub` |
   | Repository | `tripmap` |
   | Workflow filename | `release.yml` |
   | Environment | *(blank)* |
   | Allowed commands | **stage publish** only. Turn **publish** off. |

   The workflow never calls `npm publish`, so a leaked trust token can stage a version but not
   make it public. Only you can approve, and approval needs 2FA.

3. **Package access.** On the same page, choose **Require two-factor authentication and disallow
   tokens** for publishing. This blocks classic and bypass tokens from publishing directly.

4. **Tag 1.0.0.** The version is already published, so the release job skips staging and creates
   the GitHub release:

   ```sh
   git tag v1.0.0 && git push origin v1.0.0
   ```

## Releasing a new version

1. Bump `version` in `packages/cli/package.json` (for example `1.0.1`) and commit it on `main`.
   CI must be green on that commit.
2. Tag it with the same version and push the tag:

   ```sh
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. The release workflow runs three jobs:
   - **verify:** the tag must equal the package version, then typecheck, lint, unit tests, build,
     end-to-end tests, and the no-example-data check on the tarball.
   - **stage:** upgrades npm to 12 (it has the `stage` command) on Node 24, builds, and runs
     `npm stage publish -w tripmap --access public --provenance`. Nothing is public yet. If the
     version is already published, this job skips.
   - **github-release:** creates the GitHub release for the tag. This does not mean the npm
     version is public.

4. **Approve on your Mac.** Staged versions are not visible to users until you approve them:

   ```sh
   npm stage list tripmap                 # shows the staged version and its stage id
   npm stage view <stage-id>              # check the version and file list
   npm stage download <stage-id>          # optional: inspect the tarball locally
   npm stage approve <stage-id>           # prompts for your 2FA code
   ```

   Approve only after the release workflow is green and you have checked the tarball. To
   discard a staged version instead, run `npm stage reject <stage-id>`, which also asks for 2FA.

5. **Check the public release:**

   ```sh
   npm view tripmap version               # the new version, once approved
   npx --yes tripmap@1.0.1 --version
   ```

Re-running the release for a version that is already staged fails at the stage step, because npm
does not allow the same version to be staged twice. Approve or reject the staged version first.

## Checking a release

```sh
npm view tripmap version                       # the new version
npm view tripmap@1.0.1 dist.attestations       # provenance attestation is present
cd "$(mktemp -d)" && npx --yes tripmap@1.0.1 --version
```

## Troubleshooting

- **`npm stage: Unknown command` in the logs:** the npm 12 upgrade step didn't run. Staging needs npm 12.
- **Stage step fails with 401 or ENEEDAUTH:** the trusted publisher is missing, or it doesn't allow
  stage publish. Re-check the table above.
- **`You cannot publish over the previously published versions`:** that version already exists. Bump
  the version; npm does not allow reuse.

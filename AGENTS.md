# Contribution and publishing

## Changes go through PRs

All changes to `main`—features, fixes, docs, and version bumps—must go through pull requests, never direct pushes. GitHub Releases' generated notes use merged PRs, so this keeps the changelog complete. Use clear PR titles (they become changelog entries), keep each PR to one logical change, and run `npm run check` before opening it.

## Publishing

Publish to npm only through `.github/workflows/release.yml`, using npm trusted publishing (OIDC, no `NPM_TOKEN`). Never run `npm publish` locally.

1. Bump `version` in `package.json` via a PR and merge it.
2. From `main`, push a matching tag such as `v0.2.0` to trigger the workflow. Prerelease tags such as `v0.2.0-beta.1` publish under the `next` dist-tag; other releases use `latest`.

The workflow checks that the tag matches the package version, the tagged commit is on `main`, and the rebuilt `dist/` matches the committed files. Rebuild with `npm run build:entry` and commit `dist/` when source changes: GitHub installs rely on the committed output. Do not add `build` or `prepare` scripts.

After a successful publish, the workflow automatically creates a GitHub Release for the tag with generated notes from merged PRs (prerelease tags are marked as prereleases). Do not create releases by hand.

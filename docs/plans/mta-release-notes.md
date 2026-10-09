# MTA release notes and bundled changelogs

Status: implemented. Drafts are generated during release preparation, reviewed in the bump PR, and rendered from committed records during builds. Backfills and packaging have been validated against the pinned 8.3.1 sources.

## Outcome

Each MTA extension ships a useful changelog headed by its MTA version. The extension pack aggregates all user-facing changes. GitHub release notes come from the same release records, so Marketplace, Open VSX, downloaded VSIX files, and GitHub describe the same release.

This follow-up backfills 8.3.0 and 8.3.1 in future packages. Already published tags and packages remain historical artifacts; the next patch release carries the corrected changelog history.

## Findings

- MTA 8.3.0 pins upstream `14fcd6e258f1beca3b196cb0077b65c67a92d885`; MTA 8.3.1 pins `a465cff583ce30fde77aabaa9adf4dd2cda92a47`.
- At both pins, some shipped changes are described by `changes/unreleased/*.yaml`, before upstream assembles them into a versioned Markdown section. Renumbering existing upstream Markdown misses these changes.
- Upstream fragments have a kind, description, and optional extension targets. Missing targets mean core; the extension pack aggregates all fragments.
- Upstream distribution scripts already copy each extension's `CHANGELOG.md`. The released MTA 8.3.1 pack contains `extension/changelog.md` with upstream branding and a top section labeled 0.8.0, missing the 8.3.1 proxy fixes.
- The current GitHub release generator reads downstream PR titles and excludes `:seedling:` entries. Published MTA 8.3.0 and 8.3.1 GitHub notes contain only comparison links.
- The pinned publishing CLI uploads an existing VSIX unchanged when given `--packagePath`. Adding `--changelog-path` during publishing does not replace the bundled changelog.

## Release records

Add one committed YAML record per MTA release under `release-notes/`, starting with `8.3.0.yaml` and `8.3.1.yaml`. Each record contains:

- MTA version, explicit release date, and previous MTA release.
- Upstream repository and immutable starting/ending commits.
- Entries with category, reviewed description, extension targets, and source references.
- Stable source identities so a fragment later assembled upstream is not presented as a new MTA change.

Historical dates use the actual publication dates. Future preparation supplies an explicit date; rendering never uses the build clock. Same-pin releases are valid and can contain downstream-only changes.

The initial history begins with 8.3.0. For earlier releases, include a link to historical release notes rather than relabeling upstream history with guessed MTA versions.

## One release-note module

Implement `scripts/release-notes.mjs` with three operations exposed through npm scripts:

1. `release-notes:prepare -- --version <MTA-version>` drafts the next record from the previous recorded pin and current `mta-build.yaml`. Explicit overrides support backfills. It does not change the upstream pin or extension version.
2. `release-notes:render` generates cumulative per-extension Markdown and an aggregate Markdown section for the current release from the reviewed records.
3. `release-notes:check` validates records and, when given a distribution directory, verifies the actual VSIX contents and changelog manifest assets.

Keep source collection, source identity matching, rendering, and validation inside this module. Callers provide repository/workspace paths and versions; branding and CI do not implement their own changelog rules.

### Draft collection and review

- Read only commits in the recorded upstream range. Resolve and record SHAs during preparation; never use a floating branch or GitHub's latest release during rendering.
- Gather new or changed unreleased fragments and newly assembled changelog entries across that range. Account for intermediate commits so a fragment created and consumed between the two pins is not lost.
- Match assembly entries to their fragment sources where possible. Deduplicate using source identity and normalized category/text/targets; ambiguous matches remain explicit review items. A PR number alone is insufficient because one PR can supply several distinct notes.
- A fragment's removal during upstream assembly is bookkeeping, not a new change. Do not repeat content already covered by a previous MTA record.
- Report upstream commits lacking a changelog source for review. A reviewer adds a useful note or records an explicit exclusion for build/test-only changes. Missing sources must not silently produce an apparently complete draft.
- Preserve breaking changes and configuration names. Translate human-facing Konveyor branding to MTA, retaining accurate upstream links and technical identifiers.
- Allow downstream-only entries and editorial exclusions/rewrites in the same record. Reviewers can remove infrastructure details and shorten long descriptions without losing provenance.
- Require preparation to resolve review items before a release record passes validation.

The first backfill needs editorial review of 8.3.0's broader change range. The 8.3.1 record should include custom CA handling through proxies, provider-specific proxy settings, and faster failures with actionable provider connection diagnostics.

### Rendering rules

- Produce `## [8.3.1] - 2026-10-08` style headings, latest first, with MTA extension names.
- Preserve upstream categories: breaking changes, features, enhancements, fixes, and deprecations.
- Honor extension targets. Core-only changes appear in core and the aggregate extension pack; language-specific changes appear in their language extension and the pack.
- When a language extension shares a version bump without language-specific changes, state that explicitly and link to the shared core/pack notes.
- Include source links and upstream provenance without claiming that an upstream version numerically corresponds to an MTA version.
- Rendering is deterministic and idempotent. It does not modify reviewed records or delete upstream fragments.

## Packaging and publishing integration

1. Extend `scripts/pull-upstream.js` to copy the release-note module and records into the generated workspace alongside the branding overlay.
2. Run rendering through the prebuild overlay so local builds also receive MTA changelogs. Validate the generated files in postbuild. Missing or mismatched records must fail the build, including explicit CI checks that cannot be swallowed by the upstream lifecycle scripts' `|| echo` fallback.
3. In the package job, validate the final stable tag against the configured MTA version and release record after the existing version-setting step. Development versions keep the reviewed MTA history and are explicitly treated as development builds, without inventing a published release entry. Define prerelease behavior with explicit records before enabling that publishing path.
4. Render before `npm run dist`, using the existing upstream copy and packaging scripts. Avoid patching VSIX archives after packaging.
5. Check every produced VSIX, including all six C# targets, for the changelog content and its `Microsoft.VisualStudio.Services.Content.Changelog` manifest asset. Use the manifest's declared path; the publishing CLI normalizes the packaged filename to lowercase.
6. Upload the current aggregate notes as `changelog-artifact` from the package job. Add a dependency that makes this artifact available to the reusable release workflow.
7. Remove the downstream PR-title generation job from `.github/workflows/release.yml`. Download the package job's notes artifact for the GitHub release body. Remove the ineffective publish-time `--changelog-path` option; both registries publish the already verified packages.

Release rendering and publishing require no live source discovery. They use the checked-in records and the exact pinned workspace.

## Implementation slices

1. **Source records and draft preparation:** add the module, schema validation, draft collection, reviewed 8.3.0/8.3.1 backfills, and documented release-preparation commands.
2. **Bundled changelogs:** render into the branding overlay, add build checks, and verify generated VSIX files. This delivers useful Marketplace history independently of GitHub release integration.
3. **Shared publishing notes:** upload the aggregate notes during packaging and switch GitHub release publishing to consume that artifact.

Each slice can be reviewed separately. The record format and renderer introduced in the first slice are reused by the following slices.

## Acceptance checks

- Tests cover pending fragments at a release pin, fragments consumed between pins, multiple upstream releases between MTA releases, and assembly-only commits without duplicated entries.
- Tests cover extension targeting, pack aggregation, missing-fragment review items, downstream-only same-pin releases, ambiguous matches, preserved identifiers/URLs, stable dates/order, and repeated rendering.
- Build fixtures verify missing records, unresolved review items, incorrect pins, duplicate versions, and stable-tag/version mismatches fail explicitly.
- Package representative fixtures and inspect the ZIP and manifest; CI inspects every real VSIX, including all C# targets. Assert expected MTA headings, descriptions, and changelog history, not just file existence.
- A preview of 8.3.1 contains the three provider/proxy fixes under 8.3.1; core and pack show them, and language extensions accurately explain their shared version bump.
- GitHub's current-release body agrees with the corresponding aggregate changelog section. Marketplace and Open VSX receive the same verified VSIX bytes.

## Evidence

- [MTA v8.3.1 release](https://github.com/migtools/editor-extensions/releases/tag/v8.3.1)
- [Pinned upstream changelog tooling](https://github.com/konveyor/editor-extensions/blob/a465cff583ce30fde77aabaa9adf4dd2cda92a47/scripts/changelog.js)
- [Pinned upstream distribution script](https://github.com/konveyor/editor-extensions/blob/a465cff583ce30fde77aabaa9adf4dd2cda92a47/scripts/copy-dist.js)
- [Current release-note generator](https://github.com/konveyor/release-tools/blob/main/.github/workflows/generate-changelog.yml)
- [Publishing CLI behavior at v3.9.2](https://github.com/microsoft/vscode-vsce/blob/v3.9.2/src/publish.ts)

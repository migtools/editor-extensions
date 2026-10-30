# Preparing MTA release notes

The YAML records in this directory are the reviewed source for the changelogs inside every
MTA VSIX and for the GitHub release body. Rendering uses committed records and does not query
GitHub or reinterpret upstream history during a release build.

`history.md` contains the manually curated stable MTA history from 8.0.0 through 8.2.1.
It is included unchanged in every bundled changelog, with an explanation that these entries
describe shared MTA product history, including the earlier combined extension. Correct older
wording in that file; use versioned YAML records for releases from 8.3.0 onward. The renderer
checks the join between the curated history and the newer records, their order, and their dates.
GitHub release bodies contain the current release's entry; VSIX changelogs contain the complete
history.

For the next release:

1. Update the upstream SHA in `mta-build.yaml` and the MTA version in `package.json`,
   `package-lock.json`, and `scripts/prebuild.js`.
2. Fetch the new source commits into an upstream clone. The existing `.upstream-workspace`
   works: `git -C .upstream-workspace fetch origin`. For a fresh setup, run
   `npm run pull-upstream` first, or use another clone with `--workspace /path/to/clone`.
3. Generate a draft with an explicit planned release date:

   ```bash
   npm run release-notes:prepare -- --version 8.3.3 --date YYYY-MM-DD
   ```

4. Review every item in `review`. Rewrite descriptions for MTA users, verify extension targets,
   and confirm the change is present at the ending pin. For a fragment to exclude, move its
   entire entry to `excluded` as `{ id: <source.id>, entry: <original entry>, reason: <reason> }`.
   For a commit without notes, add a downstream entry or an exclusion with its review ID and a
   reason. Preserve the source keys even when rewriting descriptions: they prevent upstream
   assembly from duplicating an earlier MTA entry. Clear resolved review items.
5. Run `npm test` and `npm run release-notes:check`. Commit the release record with the version
   and upstream bump so reviewers can assess the user-facing notes in the PR.
6. Run `npm run pull-upstream` again to copy the reviewed records into the build overlay, then
   build and package normally. Mandatory lifecycle hooks render and check the changelogs.

A downstream-only release may use the same starting and ending upstream pin. Add its notes
manually with `kind`, `description`, `extensions`, and `source`. A source consists of a stable
`id`, a 64-character SHA-256 `key` identifying the original note, and an absolute HTTPS `url`.
Generate a key for an original downstream entry with:

```bash
node -e 'console.log(require("node:crypto").createHash("sha256").update("downstream:describe-the-change").digest("hex"))'
```

Kinds are `breaking`, `feature`, `enhancement`, `bugfix`, and `deprecation`. Extension targets
are `core`, `java`, `javascript`, `go`, `csharp`, and `konveyor` (the MTA extension pack).
The pack aggregates all entries; other extensions include only their targeted entries.

For a local package preview:

```bash
npm run release-notes:render -- --workspace .upstream-workspace
npm run release-notes:check -- --workspace .upstream-workspace
# After npm run dist and npm run package inside the workspace:
npm run release-notes:check -- --dist .upstream-workspace/dist --notes .upstream-workspace/release.md --tag v8.3.2
```

Stable tags must match the configured MTA version and the reviewed record. Development packages
may append `-dev.*` to that version and retain its reviewed history. Other prerelease versions
are rejected until an explicit record format and release policy are added.

The 8.3.0 and 8.3.1 records backfill the actual published versions alongside the curated older
history. Corrected historical notes reach the registries in a future patch release. Published
packages and tags are not rewritten.

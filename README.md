# MTA VSCode Extension Build Repository

This repository builds the **Migration Toolkit for Applications (MTA)** branded VSCode extensions from the upstream [konveyor/editor-extensions](https://github.com/konveyor/editor-extensions) repository.

## What This Repository Contains

This is a **build orchestrator repository** - it contains only:

- **mta-build.yaml** - All configuration: upstream pointer, branding, extension configs
- **assets/** - MTA-specific branding assets (icons, README)
- **scripts/** - Build scripts that apply branding
- **.github/workflows/** - CI workflows for building and releasing

**No upstream code is stored here** - everything is fetched from konveyor/editor-extensions at build time.

## Architecture

The MTA extensions are built using a "pointer + overlay" approach:

1. **Pointer**: `mta-build.yaml` specifies which upstream ref to build from
2. **Overlay**: MTA branding is applied by transforming `package.json` files
3. **Build**: Uses upstream konveyor build infrastructure (npm scripts, webpack)
4. **Output**: MTA-branded VSCode extensions (core, java, javascript)

### How Branding Works

All extension identity flows from `package.json`:

1. `mta-build.yaml` defines the branding (names, publisher, version, etc.)
2. `apply-branding.js` transforms each extension's `package.json`
3. Webpack's DefinePlugin injects values from `package.json` as build-time constants
4. Source code uses constants like `EXTENSION_NAME`, `EXTENSION_ID`, `CORE_EXTENSION_ID`

No source code modifications needed - just `package.json` transformations.

## Directory Structure

```
migtools/editor-extensions/
├── mta-build.yaml              # All configuration in one file
├── assets/
│   ├── icons/
│   │   ├── sidebar.png         # MTA icon for VSCode activity bar
│   │   └── avatar.svg          # MTA avatar for webview
│   └── README.md               # MTA-branded README for marketplace
├── scripts/
│   ├── pull-upstream.js        # Clone upstream and apply overlay
│   ├── apply-branding.js       # Transform package.json files
│   └── update-upstream.sh      # Update upstream ref
├── package.json
├── LICENSE
└── README.md                   # This file
```

## Configuration (mta-build.yaml)

```yaml
# Upstream source
upstream:
  repository: konveyor/editor-extensions
  ref: <commit-sha>
  semanticRef: v0.4.0

# Branding applied to all extensions
branding:
  version: "8.0.0"
  publisher: redhat
  author: Red Hat
  coreExtensionId: redhat.mta-vscode-extension
  # ... other fields

# Per-extension configuration
extensions:
  core:
    enabled: true
    name: mta-vscode-extension
    displayName: Migration Toolkit for Applications
    # ...
  java:
    enabled: true
    name: mta-java
    # ...

# Asset mappings
assets:
  - from: assets/icons/sidebar.png
    to: vscode/core/resources/icon.png
```

## Local Development

### Updating Upstream Version

```bash
# Update to latest commit on a branch
npm run update-upstream -- release-0.4

# Update to latest commit on main
npm run update-upstream -- main

# Update to a specific tag
npm run update-upstream -- v0.4.1

# Refresh current semanticRef to latest SHA (no args)
npm run update-upstream
```

### Building Locally

```bash
# Install dependencies
npm install

# Pull upstream and apply MTA overlay
npm run pull-upstream

# Build in the upstream workspace
cd .upstream-workspace
npm ci
npm run collect-assets
npm run build
npm run dist
npm run package

# VSIXs will be in .upstream-workspace/dist/
```

### Workflow

1. **Update upstream version**: `npm run update-upstream -- release-0.4`
2. **Test locally**: `npm run pull-upstream && cd .upstream-workspace && npm ci && npm run build`
3. **Verify branding**: Check the built extensions
4. **Commit and push**: `git add mta-build.yaml && git commit && git push`
5. **CI builds automatically** and creates release

## Releasing

To release MTA based on a new konveyor version:

```bash
# Update to new upstream version
npm run update-upstream -- v0.4.2

# Commit and tag
git add mta-build.yaml
git commit -m "Release MTA 8.0.1 based on konveyor v0.4.2"
git tag mta-v8.0.1
git push origin main --tags
```

The CI will automatically build MTA extensions from the new upstream version.

## Manual Builds

Trigger a build from a specific upstream ref without changing mta-build.yaml:

```bash
gh workflow run mta-build.yml -f upstream_ref=main
gh workflow run mta-build.yml -f upstream_ref=v0.4.2
gh workflow run mta-build.yml -f upstream_ref=abc1234  # specific commit
```

## License

Apache-2.0

## Links

- **Upstream**: https://github.com/konveyor/editor-extensions
- **MTA Product**: https://developers.redhat.com/products/mta/overview
- **Issues**: https://github.com/migtools/editor-extensions/issues

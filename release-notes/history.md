The entries below describe shared MTA release history through 8.2.1, including the earlier combined extension. They were curated from the published MTA tags and their source changes. Newer entries above describe changes for this extension.

## [8.2.1] - 2026-08-07

### Bug Fixes

- Match the Hub's label-selector semantics for synced analysis profiles so IDE and Hub analyses select the same rules.
- Wait for a second consecutive health-check failure before reconnecting the solution server, avoiding disruptive reconnects after a transient failure.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.2.1) · [Release source](https://github.com/migtools/editor-extensions/tree/869d03d521bb80a7d9e078a333c7a77e58c6f8e3) · [Upstream source](https://github.com/konveyor/editor-extensions/tree/1eaac3c6d31332b12770606e7bfe77c5d295b15d).

## [8.2.0] - 2026-07-22

### New Features

- Add OIDC authentication and a Hub connection status panel with sign-in, sign-out, token expiry, and connection indicators.
- Bundle stable rulesets with their language extensions, so each installed language supplies its own analysis rules.
- Allow administrators to override analyzer download locations with `ANALYZER_FALLBACK_BASE_URL` for air-gapped environments.

### Enhancements

- Improve the display of agent tool activity with compact indicators and collapsible tool groups.
- Add a configurable model-request timeout and clearer warnings when an AI provider fails to respond.
- Use MTA 8.2.0 analyzer assets.

### Bug Fixes

- Preserve solution-server connection and session state during token refresh, and refresh the Hub LLM proxy's credentials with the new token.
- Treat tokens without expiry metadata as long-lived, preventing an immediate token-refresh loop.
- Wait for the Java Language Server's Standard mode before starting Java analysis, improving activation in Dev Spaces.
- Honor `NO_PROXY` for Hub and model-provider connections, including loopback addresses.
- Improve Windows named-pipe handling for Go and C# providers and shorten macOS socket paths.
- Improve analysis recovery and solution-review behavior, including restoring clean file contents when review tabs close, retaining accepted edits, and avoiding workflow stalls.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.2.0) · [Release source](https://github.com/migtools/editor-extensions/tree/dd8ccbc9f0f82c19223f273854a51d0762d8ffdd) · [Upstream source](https://github.com/konveyor/editor-extensions/tree/6d6097eaa1b0ad030a750d15b46cfcae45739ae6).

## [8.1.3] - 2026-05-07

### Enhancements

- Discover available source and target labels from bundled rulesets, restoring missing Spring and other migration targets in the profile editor.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.1.3) · [Release source](https://github.com/migtools/editor-extensions/tree/87e81ca388b0d8cb33f5efd18d17aa8692666288) · [Upstream source](https://github.com/konveyor/editor-extensions/tree/35a1893500f22684d49e27c9c38904dc10b8ea2b).

## [8.1.2] - 2026-05-04

### Bug Fixes

- Store Hub-synced profiles separately from user-managed profiles and restore local profile management when sync is disabled.
- Retry Java extension activation after startup failures.
- Send the user's in-place edits to the solution server when accepting a proposed solution.
- Clear pending diff and review state when an editor tab closes, allowing review to continue.
- Reset workflow state when a batch review finishes so subsequent analysis can run.
- Correct Hub LLM proxy enablement and MTA branding in Hub configuration.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.1.2) · [Release source](https://github.com/migtools/editor-extensions/tree/197443d5ced9f057d14685971b8d5b789b3de422) · [Upstream source](https://github.com/konveyor/editor-extensions/tree/de70394013c6cd86305622bee2cc2bdb634b3775).

## [8.1.1] - 2026-03-26

### Bug Fixes

- Correct MTA names, command links, extension identifiers, and installation links in welcome views.
- Apply the MTA icon to the extension pack and replace remaining hardcoded upstream branding.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.1.1) · [Release source](https://github.com/migtools/editor-extensions/tree/43b6f6f4c767c4a3b7598a8bda413d9763c2e809) · [Upstream source](https://github.com/konveyor/editor-extensions/tree/f52d0e73369777e3793fc201d66c43514dcde398).

## [8.1.0] - 2026-03-26

### New Features

- Introduce an extension pack with shared MTA Core and separate Java, JavaScript, Go, and C# language support.
- Add Hub connection configuration and profile synchronization for centrally managed analysis profiles.
- Add workspace analysis profiles, batch solution review, and richer analysis-progress reporting.
- Add language-provider health checks and core/language-extension compatibility checks.

### Enhancements

- Improve welcome views, file suggestions, model-error reporting, and network diagnostics.
- Support configuring Hub connections through environment variables.

### Bug Fixes

- Improve profile synchronization, configuration persistence, ignore-path handling, and analysis cancellation.
- Improve Hub LLM proxy reliability and retain solution-server session state during token refresh.
- Correct custom certificate handling for Google GenAI providers and improve macOS socket handling.
- Improve proposed-solution diffs by handling whitespace and trailing newlines correctly.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.1.0) · [Release source](https://github.com/migtools/editor-extensions/tree/6db954fecc80c1b622f579fa294460c64ebf653f) · [Upstream source](https://github.com/konveyor/editor-extensions/tree/8e563d6d6117ff7bf7f14915528826397805f396).

## [8.0.5] - 2026-03-05

### Bug Fixes

- Correct TLS certificate handling for Google GenAI requests when the provider uses a bundled HTTP client.

### Enhancements

- Add actionable network diagnostics for Hub and model-provider connection failures.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.0.5) · [Release source](https://github.com/migtools/editor-extensions/tree/d53d898883bb766bfd78a8cc86e2e199f24fc99d) · [Upstream source](https://github.com/konveyor/editor-extensions/tree/24b929790f518915ff895871252f0429e3aa3a04).

## [8.0.4] - 2026-02-25

### Bug Fixes

- Honor `CA_BUNDLE` and `ALLOW_INSECURE` for Google GenAI providers.
- Retain the SSL-bypass setting across reconnects and improve credential prompts.
- Correct configuration-error handling, the walkthrough drawer, and solution-server behavior.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.0.4) · [Release source](https://github.com/migtools/editor-extensions/tree/05745f065caab648e641b3730a0c069bcbf5c720) · [Upstream source](https://github.com/konveyor/editor-extensions/tree/67dfd7aad4ce5a0015a5c564bf91fa518c00e652).

## [8.0.3] - 2026-02-04

### Enhancements

- Make the MTA extension available through Open VSX as well as the VS Code Marketplace.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.0.3) · [Release source](https://github.com/migtools/editor-extensions/tree/0f1f80a49fe0dd83d9640e870ff19f28a5faf5f1) · [Upstream source](https://github.com/konveyor/editor-extensions/tree/780434f0d9727c5acf97d6b88f75ad2ce26ed83a).

## [8.0.2] - 2025-10-14

### Enhancements

- Update optional AI workflows and solution review, including solution-server communication and modified-file handling.
- Improve analysis-profile editing and the analysis results interface.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.0.2) · [Release source](https://github.com/migtools/editor-extensions/tree/92ab10e0d9c73008a94ea72d632da741c328f13e).

## [8.0.1] - 2025-10-01

### Bug Fixes

- Correct the extension name, icon, description, and feature listing.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.0.1) · [Release source](https://github.com/migtools/editor-extensions/tree/2baf4a2902fbe66d147607fd4fa9d03b29007297).

## [8.0.0] - 2025-09-30

### New Features

- Initial MTA VS Code extension release with rule-based application analysis, configurable analysis profiles, rulesets, and result views.
- Add optional generative AI solution suggestions and interactive review of proposed changes.
- Include experimental agent mode for applying fixes with diagnostics feedback.

[Release](https://github.com/migtools/editor-extensions/releases/tag/v8.0.0) · [Release source](https://github.com/migtools/editor-extensions/tree/3c45f56099a27437e3b3e71a6ae046562c4f4e11).

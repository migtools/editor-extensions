#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

const EXTENSIONS = {
  core: "mta-core",
  java: "mta-java",
  javascript: "mta-javascript",
  go: "mta-go",
  csharp: "mta-csharp",
  konveyor: "mta-vscode-extension",
};
const CATEGORIES = {
  breaking: "Breaking Changes",
  feature: "New Features",
  enhancement: "Enhancements",
  bugfix: "Bug Fixes",
  deprecation: "Deprecations",
};
const SHA = /^[a-f0-9]{40}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const moduleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const readYaml = (file) => parse(fs.readFileSync(file, "utf8"));
const requireValue = (condition, message) => assert.ok(condition, message);
const compareVersions = (a, b) => {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
};
const git = (repo, ...args) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
const lines = (text) => text.split("\n").filter(Boolean);

// Preserve technical identifiers, inline code, and URLs when branding prose.
function brand(text) {
  return text
    .split(/(`+[^`]*`+|https?:\/\/[^\s)]+)/g)
    .map((part, index) =>
      index % 2 ? part : part.replace(/\bKonveyor\b/g, "MTA"),
    )
    .join("");
}

function sourceKey(kind, description) {
  const normalized = description
    .replace(/\s*\(\[#\d+\]\(https?:\/\/[^)]+\)\)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  return createHash("sha256").update(`${kind}:${normalized}`).digest("hex");
}

function validateEntry(entry, label) {
  requireValue(Object.hasOwn(CATEGORIES, entry.kind), `${label}: invalid kind`);
  requireValue(
    typeof entry.description === "string" && entry.description.trim(),
    `${label}: description required`,
  );
  requireValue(
    Array.isArray(entry.extensions) &&
      entry.extensions.length > 0 &&
      entry.extensions.every((ext) => Object.hasOwn(EXTENSIONS, ext)) &&
      new Set(entry.extensions).size === entry.extensions.length,
    `${label}: invalid extension targets`,
  );
  requireValue(
    entry.source &&
      typeof entry.source.id === "string" &&
      entry.source.id &&
      /^[a-f0-9]{64}$/.test(entry.source.key) &&
      /^https:\/\//.test(entry.source.url),
    `${label}: source provenance required`,
  );
}

function loadRecords(root, { allowDrafts = false } = {}) {
  const directory = path.join(root, "release-notes");
  requireValue(fs.existsSync(directory), "Missing release-notes directory");
  const records = fs
    .readdirSync(directory)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => ({ ...readYaml(path.join(directory, file)), file }));
  const versions = new Set();
  for (const record of records) {
    const label = record.file;
    requireValue(
      VERSION.test(record.version),
      `${label}: a stable MTA version is required`,
    );
    requireValue(
      record.file === `${record.version}.yaml`,
      `${label}: filename must match version`,
    );
    requireValue(!versions.has(record.version), `${label}: duplicate version`);
    versions.add(record.version);
    requireValue(
      /^\d{4}-\d{2}-\d{2}$/.test(record.date) &&
        !Number.isNaN(Date.parse(record.date)) &&
        new Date(record.date).toISOString().slice(0, 10) === record.date,
      `${label}: valid explicit date required`,
    );
    requireValue(
      VERSION.test(record.previous),
      `${label}: previous MTA version required`,
    );
    requireValue(
      record.upstream &&
        /^[\w.-]+\/[\w.-]+$/.test(record.upstream.repository) &&
        SHA.test(record.upstream.from) &&
        SHA.test(record.upstream.to),
      `${label}: immutable upstream range required`,
    );
    requireValue(
      Array.isArray(record.entries) &&
        Array.isArray(record.excluded) &&
        Array.isArray(record.review),
      `${label}: entries, excluded, and review arrays required`,
    );
    requireValue(
      allowDrafts || record.review.length === 0,
      `${label}: unresolved review items`,
    );
    for (const entry of record.entries) validateEntry(entry, label);
    for (const exclusion of record.excluded) {
      requireValue(
        typeof exclusion.reason === "string" && exclusion.reason.trim(),
        `${label}: exclusion reason required`,
      );
      requireValue(
        typeof exclusion.id === "string" && exclusion.id,
        `${label}: exclusion identity required`,
      );
      if (exclusion.entry) validateEntry(exclusion.entry, label);
    }
  }
  records.sort((a, b) => compareVersions(a.version, b.version));
  const seenSources = new Set();
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    for (const entry of record.entries) {
      for (const extension of entry.extensions) {
        const key = `${entry.source.key}:${extension}`;
        requireValue(
          !seenSources.has(key),
          `${record.file}: duplicate source for ${extension}`,
        );
        seenSources.add(key);
      }
    }
    requireValue(
      compareVersions(record.previous, record.version) < 0,
      `${record.file}: previous version must be older`,
    );
    if (index > 0) {
      const previous = records[index - 1];
      requireValue(
        record.previous === previous.version &&
          record.upstream.repository === previous.upstream.repository &&
          record.upstream.from === previous.upstream.to,
        `${record.file}: broken release history`,
      );
      requireValue(
        record.date >= previous.date,
        `${record.file}: release dates must be chronological`,
      );
    }
  }
  return records;
}

function releaseContext(root, version) {
  const config = readYaml(path.join(root, "mta-build.yaml"));
  const configuredVersion = JSON.parse(
    fs.readFileSync(path.join(root, "package.json")),
  ).version;
  version ??= configuredVersion;
  requireValue(
    version === configuredVersion,
    "MTA version differs from package.json",
  );
  const records = loadRecords(root);
  const current = records.find((record) => record.version === version);
  requireValue(current, `Missing release record for ${version}`);
  requireValue(
    current.upstream.repository === config.upstream.repository &&
      current.upstream.to === config.upstream.ref,
    "Release record does not match configured upstream pin",
  );
  const historyPath = path.join(root, "release-notes/history.md");
  requireValue(
    fs.existsSync(historyPath),
    "Missing curated MTA release history",
  );
  const history = fs.readFileSync(historyPath, "utf8");
  const historical = [
    ...history.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm),
  ];
  requireValue(
    historical.length > 0 && historical[0][1] === records[0].previous,
    "Curated history must end at the release preceding the first record",
  );
  const versions = new Set(records.map((record) => record.version));
  let precedingVersion = records[0].version;
  let precedingDate = records[0].date;
  for (const [, historicalVersion, date] of historical) {
    requireValue(
      !versions.has(historicalVersion) &&
        compareVersions(historicalVersion, precedingVersion) < 0,
      "Curated history has duplicate or out-of-order versions",
    );
    requireValue(
      !Number.isNaN(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date &&
        date <= precedingDate,
      "Curated history has invalid or out-of-order dates",
    );
    versions.add(historicalVersion);
    precedingVersion = historicalVersion;
    precedingDate = date;
  }
  return {
    history,
    records: records.filter(
      (record) => compareVersions(record.version, version) <= 0,
    ),
    current,
  };
}

function section(record, extension) {
  let result = `## [${record.version}] - ${record.date}\n\n`;
  const entries = record.entries.filter(
    (entry) => extension === "konveyor" || entry.extensions.includes(extension),
  );
  for (const [kind, heading] of Object.entries(CATEGORIES)) {
    const matching = entries.filter((entry) => entry.kind === kind);
    if (!matching.length) continue;
    result += `### ${heading}\n\n`;
    for (const entry of matching)
      result += `- ${brand(entry.description.trim())} ([source](${entry.source.url}))\n`;
    result += "\n";
  }
  if (entries.length === 0) {
    result +=
      `No ${extension === "konveyor" ? "user-facing" : "extension-specific"} changes in this release. ` +
      `See the [MTA release notes](https://github.com/migtools/editor-extensions/releases/tag/v${record.version}) for shared changes.\n\n`;
  }
  result += `Upstream: [\`${record.upstream.to.slice(0, 7)}\`](https://github.com/${record.upstream.repository}/commit/${record.upstream.to}).\n\n`;
  return result;
}

function outputs(context) {
  const files = {};
  for (const [extension, name] of Object.entries(EXTENSIONS)) {
    files[`vscode/${extension}/CHANGELOG.md`] =
      `# Changelog\n\nRelease history for \`redhat.${name}\`.\n\n` +
      [...context.records]
        .reverse()
        .map((record) => section(record, extension))
        .join("") +
      context.history.trim() +
      "\n";
  }
  files["release.md"] =
    `# MTA ${context.current.version}\n\n${section(context.current, "konveyor")}` +
    `[Full upstream comparison](https://github.com/${context.current.upstream.repository}/compare/` +
    `${context.current.upstream.from}...${context.current.upstream.to}).\n`;
  return files;
}

function checkWorkspace(root, workspace, context, { tag } = {}) {
  if (tag !== undefined)
    requireValue(
      tag === `v${context.current.version}`,
      "Release tag differs from MTA release record",
    );
  const hasGit = fs.existsSync(path.join(workspace, ".git"));
  if (hasGit)
    requireValue(
      git(workspace, "rev-parse", "HEAD") === context.current.upstream.to,
      "Workspace upstream commit differs from release record",
    );
  for (const [extension, name] of Object.entries(EXTENSIONS)) {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(workspace, "vscode", extension, "package.json"),
      ),
    );
    requireValue(
      pkg.name === name && pkg.publisher === "redhat",
      `${extension}: MTA branding missing`,
    );
    requireValue(
      pkg.version === context.current.version ||
        pkg.version.startsWith(`${context.current.version}-dev.`),
      `${extension}: unsupported or mismatched package version`,
    );
    if (tag)
      requireValue(
        pkg.version === context.current.version,
        `${extension}: tagged releases must use a stable version`,
      );
  }
}

export function renderReleaseNotes({
  root = moduleRoot,
  workspace = path.join(root, ".upstream-workspace"),
  version,
} = {}) {
  const context = releaseContext(root, version);
  requireValue(
    git(workspace, "rev-parse", "HEAD") === context.current.upstream.to,
    "Workspace upstream commit differs from release record",
  );
  const rendered = outputs(context);
  for (const [file, content] of Object.entries(rendered)) {
    const target = path.join(workspace, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return rendered;
}

export async function checkReleaseNotes({
  root = moduleRoot,
  workspace,
  version,
  tag,
  dist,
  notes,
} = {}) {
  const context = releaseContext(root, version);
  if (tag !== undefined)
    requireValue(
      tag === `v${context.current.version}`,
      "Release tag differs from MTA release record",
    );
  const rendered = outputs(context);
  if (notes)
    requireValue(
      fs.readFileSync(notes, "utf8") === rendered["release.md"],
      "Release notes artifact differs from reviewed records",
    );
  if (workspace) {
    checkWorkspace(root, workspace, context, { tag });
    for (const [file, content] of Object.entries(rendered)) {
      requireValue(
        fs.readFileSync(path.join(workspace, file), "utf8") === content,
        `${file}: stale or missing MTA notes`,
      );
    }
  }
  if (dist) {
    const { Open } = (await import("unzipper")).default;
    const expected = new Set(
      Object.values(EXTENSIONS).filter((name) => name !== "mta-csharp"),
    );
    for (const target of [
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-arm64",
      "win32-x64",
    ]) {
      expected.add(`mta-csharp@${target}`);
    }
    const files = fs.readdirSync(dist).filter((file) => file.endsWith(".vsix"));
    requireValue(
      files.length === expected.size,
      `Expected ${expected.size} VSIX files, found ${files.length}`,
    );
    for (const file of files) {
      const zip = await Open.file(path.join(dist, file));
      const read = async (name) => {
        const entry = zip.files.find((item) => item.path === name);
        requireValue(entry, `${file}: missing ${name}`);
        return (await entry.buffer()).toString("utf8");
      };
      const pkg = JSON.parse(await read("extension/package.json"));
      const manifest = await read("extension.vsixmanifest");
      const attributes = (element) =>
        Object.fromEntries(
          [...element.matchAll(/([\w.]+)="([^"]*)"/g)].map((match) => [
            match[1],
            match[2],
          ]),
        );
      const identity = attributes(
        manifest.match(/<Identity\b[^>]*\/>/)?.[0] ?? "",
      );
      requireValue(
        identity.Id === pkg.name &&
          identity.Version === pkg.version &&
          identity.Publisher === "redhat" &&
          pkg.publisher === "redhat",
        `${file}: manifest/package identity mismatch`,
      );
      requireValue(
        pkg.version === context.current.version ||
          (!tag && pkg.version.startsWith(`${context.current.version}-dev.`)),
        `${file}: version mismatch`,
      );
      const key =
        pkg.name +
        (identity.TargetPlatform ? `@${identity.TargetPlatform}` : "");
      requireValue(
        expected.delete(key),
        `${file}: unexpected or duplicate extension target ${key}`,
      );
      const asset = [...manifest.matchAll(/<Asset\b[^>]*\/>/g)]
        .map((match) => attributes(match[0]))
        .filter(
          (item) =>
            item.Type === "Microsoft.VisualStudio.Services.Content.Changelog",
        );
      requireValue(
        asset.length === 1,
        `${file}: one changelog manifest asset required`,
      );
      const extension = Object.keys(EXTENSIONS).find(
        (ext) => EXTENSIONS[ext] === pkg.name,
      );
      // VSCE rewrites Markdown links when packaging. Our notes use absolute links,
      // so only its CRLF normalization needs accounting for here.
      requireValue(
        (await read(asset[0].Path)).replace(/\r\n/g, "\n") ===
          rendered[`vscode/${extension}/CHANGELOG.md`],
        `${file}: bundled changelog differs from reviewed MTA notes`,
      );
    }
    requireValue(
      expected.size === 0,
      `Missing VSIX targets: ${[...expected].join(", ")}`,
    );
  }
  return context.current;
}

function markdownEntries(text, extension, repository, commit, file) {
  const entries = [];
  let kind;
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) kind = undefined;
    const heading = line.match(/^### (.+)$/)?.[1];
    if (heading)
      kind = Object.keys(CATEGORIES).find(
        (candidate) => CATEGORIES[candidate] === heading,
      );
    if (kind && line.startsWith("- ")) {
      const description = line
        .slice(2)
        .replace(/\s*\(\[#\d+\]\(https?:\/\/[^)]+\)\)\s*$/, "");
      entries.push({
        kind,
        description,
        extensions: [extension],
        source: {
          id: `markdown:${file}:${sourceKey(kind, description)}`,
          key: sourceKey(kind, description),
          url: `https://github.com/${repository}/blob/${commit}/${file}`,
        },
      });
    }
  }
  return entries;
}

function fragmentEntry(repo, repository, commit, file) {
  const fragment = parse(git(repo, "show", `${commit}:${file}`));
  const entry = {
    kind: fragment.kind,
    description: fragment.description,
    extensions: fragment.extensions ?? ["core"],
    source: {
      id: `fragment:${file}`,
      key: sourceKey(fragment.kind, fragment.description),
      url: `https://github.com/${repository}/blob/${commit}/${file}`,
    },
  };
  validateEntry(entry, file);
  return entry;
}

export function prepareRelease({
  root = moduleRoot,
  workspace = path.join(root, ".upstream-workspace"),
  version,
  date,
  from,
  to,
  previous,
  output,
} = {}) {
  requireValue(
    VERSION.test(version),
    "prepare requires --version with a stable MTA version",
  );
  requireValue(
    /^\d{4}-\d{2}-\d{2}$/.test(date),
    "prepare requires an explicit --date (YYYY-MM-DD)",
  );
  const config = readYaml(path.join(root, "mta-build.yaml"));
  const records = fs.existsSync(path.join(root, "release-notes"))
    ? loadRecords(root)
    : [];
  requireValue(
    !records.some((record) => record.version === version),
    `Release ${version} already exists`,
  );
  const prior = records
    .filter((record) => compareVersions(record.version, version) < 0)
    .at(-1);
  from ??= prior?.upstream.to;
  to ??= config.upstream.ref;
  previous ??= prior?.version;
  requireValue(
    SHA.test(from) && SHA.test(to) && VERSION.test(previous),
    "Initial record requires --from and --previous; both pins must be SHAs",
  );
  requireValue(
    compareVersions(previous, version) < 0,
    "Previous MTA release must be older",
  );
  // Downstream may switch between upstream release branches. The previous
  // pin need not be an ancestor, but both commits must exist and share history.
  git(workspace, "merge-base", from, to);
  const repository = config.upstream.repository;
  const covered = new Set();
  const identities = new Map();
  const remember = (entry) => {
    for (const ext of entry.extensions)
      covered.add(`${entry.source.key}:${ext}`);
    identities.set(entry.source.id, entry.source.key);
  };
  for (const record of records) {
    for (const entry of record.entries) remember(entry);
    for (const exclusion of record.excluded)
      if (exclusion.entry) remember(exclusion.entry);
  }
  // Changes already present at the start pin are never new in this range,
  // including fragments still awaiting upstream assembly.
  for (const file of lines(
    git(workspace, "ls-tree", "-r", "--name-only", from, "changes/unreleased"),
  )) {
    if (/\.ya?ml$/.test(file))
      remember(fragmentEntry(workspace, repository, from, file));
  }
  for (const extension of Object.keys(EXTENSIONS)) {
    const file = `vscode/${extension}/CHANGELOG.md`;
    if (git(workspace, "ls-tree", "--name-only", from, file)) {
      for (const entry of markdownEntries(
        git(workspace, "show", `${from}:${file}`),
        extension,
        repository,
        from,
        file,
      ))
        remember(entry);
    }
  }
  const entries = [];
  const review = [];
  const commits = lines(
    git(workspace, "rev-list", "--reverse", "--topo-order", `${from}..${to}`),
  );
  for (const commit of commits) {
    const changed = lines(
      git(
        workspace,
        "diff-tree",
        "--no-commit-id",
        "--name-status",
        "-r",
        `${commit}^`,
        commit,
      ),
    );
    let hasSource = false;
    for (const change of changed) {
      const [status, file] = change.split("\t");
      const isFragment = /^changes\/unreleased\/.+\.ya?ml$/.test(file);
      const extension = file.match(
        /^vscode\/(core|java|javascript|go|csharp|konveyor)\/CHANGELOG.md$/,
      )?.[1];
      if (!isFragment && !extension) continue;
      hasSource = true;
      if (status === "D") continue;
      const candidates = isFragment
        ? [fragmentEntry(workspace, repository, commit, file)]
        : markdownEntries(
            git(workspace, "show", `${commit}:${file}`),
            extension,
            repository,
            commit,
            file,
          );
      for (const candidate of candidates) {
        // The pack's assembled notes repeat every extension's entries. Only
        // collect a pack-only Markdown entry when no other source covers it.
        if (
          !isFragment &&
          extension === "konveyor" &&
          [...covered].some((key) => key.startsWith(`${candidate.source.key}:`))
        )
          continue;
        const targets = candidate.extensions.filter(
          (ext) => !covered.has(`${candidate.source.key}:${ext}`),
        );
        if (!targets.length) continue;
        if (
          identities.has(candidate.source.id) &&
          identities.get(candidate.source.id) !== candidate.source.key
        ) {
          review.push({
            id: `edited:${candidate.source.id}:${commit}`,
            reason:
              "Previously recorded source was edited; check whether this is a new user-facing change",
          });
        }
        const existing = entries.find(
          (entry) => entry.source.key === candidate.source.key,
        );
        if (existing)
          existing.extensions = [
            ...new Set([...existing.extensions, ...targets]),
          ];
        else
          entries.push({
            ...candidate,
            description: brand(candidate.description),
            extensions: targets,
          });
        remember(candidate);
      }
    }
    if (!hasSource)
      review.push({
        id: `commit:${commit}`,
        reason: git(workspace, "show", "-s", "--format=%s", commit),
      });
  }
  // The candidate list also needs editorial review: a fragment may describe
  // a reverted feature or contain engineering-only details.
  for (const entry of entries)
    review.push({
      id: entry.source.id,
      reason:
        "Review description, scope, and whether the change is shipped at the ending pin",
    });
  const record = {
    version,
    date,
    previous,
    upstream: { repository, from, to },
    entries,
    excluded: [],
    review,
  };
  output ??= path.join(root, "release-notes", `${version}.yaml`);
  requireValue(!fs.existsSync(output), `Refusing to overwrite ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, stringify(record, { lineWidth: 100 }));
  return record;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  const flags = new Set([
    "root",
    "workspace",
    "version",
    "date",
    "from",
    "to",
    "previous",
    "output",
    "tag",
    "dist",
    "notes",
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, "");
    requireValue(
      args[index].startsWith("--") &&
        flags.has(key) &&
        args[index + 1] &&
        !args[index + 1].startsWith("--"),
      `Invalid option: ${args[index]}`,
    );
    options[key] = args[index + 1];
  }
  if (command === "prepare") {
    const record = prepareRelease(options);
    console.log(
      `Prepared ${record.version}: ${record.entries.length} entries, ${record.review.length} review items`,
    );
  } else if (command === "render") {
    const files = renderReleaseNotes(options);
    console.log(`Rendered ${Object.keys(files).length} MTA release-note files`);
  } else if (command === "check") {
    const record = await checkReleaseNotes(options);
    console.log(
      `Verified MTA ${record.version} release notes${options.dist ? " and all 11 VSIX files" : ""}`,
    );
  } else
    throw new Error(
      "Usage: release-notes.mjs prepare|render|check [--root path] [--workspace path] [--version version] [--tag tag] [--dist path]",
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createVSIX } from "@vscode/vsce";
import { parse, stringify } from "yaml";
import {
  prepareRelease,
  renderReleaseNotes,
  checkReleaseNotes,
} from "./release-notes.mjs";

const extensions = {
  core: "mta-core",
  java: "mta-java",
  javascript: "mta-javascript",
  go: "mta-go",
  csharp: "mta-csharp",
  konveyor: "mta-vscode-extension",
};
const targets = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mta-notes-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "upstream");
  fs.mkdirSync(workspace);
  const git = (...args) =>
    execFileSync("git", ["-C", workspace, ...args], {
      encoding: "utf8",
    }).trim();
  git("init", "--quiet");
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
    fs.writeFileSync(path.join(workspace, file), content);
  };
  const commit = (message) => {
    git("add", ".");
    git(
      "-c",
      "user.name=Release Notes Test",
      "-c",
      "user.email=notes@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      message,
    );
    return git("rev-parse", "HEAD");
  };
  for (const [extension, name] of Object.entries(extensions)) {
    write(
      `vscode/${extension}/package.json`,
      JSON.stringify({ name, publisher: "redhat", version: "8.3.1" }),
    );
    write(`vscode/${extension}/CHANGELOG.md`, "# Changelog\n");
  }
  const base = commit("baseline");
  const configure = (to, version = "8.3.1") => {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ version }),
    );
    fs.writeFileSync(
      path.join(root, "mta-build.yaml"),
      stringify({
        upstream: { repository: "konveyor/editor-extensions", ref: to },
      }),
    );
  };
  const fragment = (file, description, extensions) =>
    write(
      `changes/unreleased/${file}.yaml`,
      stringify({
        kind: "bugfix",
        description,
        ...(extensions && { extensions }),
      }),
    );
  const draft = (version, to, options = {}) => {
    configure(to);
    return prepareRelease({
      root,
      workspace,
      version,
      date: version === "8.3.0" ? "2026-10-06" : "2026-10-08",
      ...options,
    });
  };
  const approve = (version, edit = () => {}) => {
    const file = path.join(root, "release-notes", `${version}.yaml`);
    const record = parse(fs.readFileSync(file, "utf8"));
    record.excluded = record.review
      .filter((item) => item.id.startsWith("commit:"))
      .map((item) => ({ id: item.id, reason: "Test tooling only" }));
    record.review = [];
    edit(record);
    fs.writeFileSync(file, stringify(record));
    return record;
  };
  const first = () => {
    fragment("100-core", "Fix core connections.");
    const to = commit("core fix with pending fragment");
    draft("8.3.0", to, { from: base, previous: "8.2.1" });
    approve("8.3.0");
    return to;
  };
  const second = () => {
    fragment("101-java", "Fix Java analysis.", ["java"]);
    const to = commit("java fix");
    const record = draft("8.3.1", to);
    approve("8.3.1");
    return record;
  };
  return {
    root,
    workspace,
    write,
    commit,
    configure,
    fragment,
    draft,
    approve,
    first,
    second,
    base,
  };
}

test("pending fragments become MTA-versioned notes with correct targets and deterministic history", async (t) => {
  const f = fixture(t);
  f.first();
  f.second();
  const first = renderReleaseNotes(f);
  assert.deepEqual(renderReleaseNotes(f), first);
  assert.match(first["vscode/core/CHANGELOG.md"], /\[8\.3\.1\].*2026-10-08/);
  assert.match(
    first["vscode/core/CHANGELOG.md"],
    /No extension-specific changes/,
  );
  assert.match(first["vscode/core/CHANGELOG.md"], /Fix core connections/);
  assert.doesNotMatch(first["vscode/core/CHANGELOG.md"], /Fix Java analysis/);
  assert.match(first["vscode/java/CHANGELOG.md"], /Fix Java analysis/);
  assert.match(first["vscode/konveyor/CHANGELOG.md"], /Fix Java analysis/);
  assert.match(first["vscode/konveyor/CHANGELOG.md"], /Fix core connections/);
  assert.match(first["release.md"], /Fix Java analysis/);
  assert.doesNotMatch(first["release.md"], /Fix core connections/);
  await checkReleaseNotes({
    ...f,
    notes: path.join(f.workspace, "release.md"),
    tag: "v8.3.1",
  });
});

test("fragments consumed between pins and multiple assembled releases are collected once", (t) => {
  const f = fixture(t);
  f.first();
  fs.rmSync(path.join(f.workspace, "changes/unreleased/100-core.yaml"));
  f.write(
    "vscode/core/CHANGELOG.md",
    "# Changelog\n\n## [0.8.0]\n\n### Bug Fixes\n\n- Fix core connections.\n",
  );
  f.commit("assemble old release");
  f.fragment("101-new", "Fix HTTPS_PROXY handling.");
  f.commit("new fix");
  fs.rmSync(path.join(f.workspace, "changes/unreleased/101-new.yaml"));
  f.write(
    "vscode/core/CHANGELOG.md",
    "# Changelog\n\n## [0.8.1]\n\n### Bug Fixes\n\n- Fix HTTPS_PROXY handling. ([#101](https://github.com/konveyor/editor-extensions/pull/101))\n\n## [0.8.0]\n\n### Bug Fixes\n\n- Fix core connections.\n",
  );
  f.commit("assemble next release");
  f.fragment("102-new", "Fix timeouts.");
  const to = f.commit("another pending fix");
  const record = f.draft("8.3.1", to);
  assert.equal(record.entries.length, 2);
  assert.deepEqual(
    record.entries.map((entry) => entry.description),
    ["Fix HTTPS_PROXY handling.", "Fix timeouts."],
  );
  assert.equal(
    record.review.filter((item) => item.id.startsWith("commit:")).length,
    0,
  );
});

test("new Markdown-only entries are collected while assembly-only commits add no notes", (t) => {
  const f = fixture(t);
  f.first();
  f.write(
    "vscode/core/CHANGELOG.md",
    "# Changelog\n\n## [0.8.0]\n\n### Bug Fixes\n\n- Fix core connections.\n\n- Document missing change.\n",
  );
  const to = f.commit("assemble with historical Markdown-only note");
  const record = f.draft("8.3.1", to);
  assert.equal(record.entries.length, 1);
  assert.equal(record.entries[0].description, "Document missing change.");
});

test("pack-only Markdown notes are collected without repeating aggregated core entries", (t) => {
  const f = fixture(t);
  f.first();
  f.write(
    "vscode/konveyor/CHANGELOG.md",
    "# Changelog\n\n## [0.8.0]\n\n### Bug Fixes\n\n- Fix core connections.\n\n- Improve the extension pack.\n",
  );
  const to = f.commit("assemble pack notes");
  const record = f.draft("8.3.1", to);
  assert.equal(record.entries.length, 1);
  assert.equal(record.entries[0].description, "Improve the extension pack.");
  assert.deepEqual(record.entries[0].extensions, ["konveyor"]);
});

test("edited sources and commits without notes require review; drafts cannot ship", async (t) => {
  const f = fixture(t);
  f.first();
  f.fragment("100-core", "Fix core connections and retries.");
  f.commit("edit existing fragment");
  f.write("README.md", "Changed documentation");
  const to = f.commit("no changelog source");
  const record = f.draft("8.3.1", to);
  assert.ok(record.review.some((item) => item.id.startsWith("edited:")));
  assert.ok(
    record.review.some((item) => item.reason === "no changelog source"),
  );
  await assert.rejects(
    checkReleaseNotes({ root: f.root }),
    /unresolved review/,
  );
});

test("same-pin downstream releases are supported and technical names/URLs retain their spelling", async (t) => {
  const f = fixture(t);
  const to = f.first();
  f.draft("8.3.1", to);
  f.approve("8.3.1", (record) => {
    record.entries = [
      {
        ...parse(
          fs.readFileSync(
            path.join(f.root, "release-notes/8.3.0.yaml"),
            "utf8",
          ),
        ).entries[0],
        description:
          "Improve Konveyor notes; retain `Konveyor`, konveyor-core, CA_BUNDLE, and https://example.test/Konveyor.",
        source: {
          id: "downstream:notes",
          key: "a".repeat(64),
          url: "https://github.com/migtools/editor-extensions",
        },
      },
    ];
  });
  const rendered = renderReleaseNotes(f);
  assert.match(
    rendered["release.md"],
    /Improve MTA notes; retain `Konveyor`, konveyor-core, CA_BUNDLE, and https:\/\/example.test\/Konveyor\./,
  );
  await checkReleaseNotes(f);
});

test("excluded sources are not rediscovered when upstream assembles them", (t) => {
  const f = fixture(t);
  f.first();
  f.approve("8.3.0", (record) => {
    record.excluded.push({
      id: record.entries[0].source.id,
      entry: record.entries[0],
      reason: "Not relevant downstream",
    });
    record.entries = [];
  });
  f.write(
    "vscode/core/CHANGELOG.md",
    "# Changelog\n\n## [0.8.0]\n\n### Bug Fixes\n\n- Fix core connections.\n",
  );
  const to = f.commit("assemble excluded source");
  const record = f.draft("8.3.1", to);
  assert.equal(record.entries.length, 0);
});

test("validation rejects missing records, incorrect pins, broken history, invalid targets and dates", async (t) => {
  const f = fixture(t);
  const to = f.first();
  f.configure(to);
  await assert.rejects(
    checkReleaseNotes({ root: f.root }),
    /Missing release record/,
  );
  f.second();
  const file = path.join(f.root, "release-notes/8.3.1.yaml");
  const original = fs.readFileSync(file, "utf8");
  for (const [edit, error] of [
    [
      (r) => {
        r.upstream.to = "b".repeat(40);
      },
      /configured upstream pin/,
    ],
    [
      (r) => {
        r.upstream.from = "b".repeat(40);
      },
      /broken release history/,
    ],
    [
      (r) => {
        r.entries[0].extensions = ["unknown"];
      },
      /invalid extension targets/,
    ],
    [
      (r) => {
        r.date = "2026-02-30";
      },
      /valid explicit date/,
    ],
    [
      (r) => {
        r.entries.push(r.entries[0]);
      },
      /duplicate source/,
    ],
  ]) {
    const record = parse(original);
    edit(record);
    fs.writeFileSync(file, stringify(record));
    await assert.rejects(checkReleaseNotes({ root: f.root }), error);
  }
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(f.root, "release-notes/duplicate.yaml"), original);
  await assert.rejects(
    checkReleaseNotes({ root: f.root }),
    /filename must match|duplicate version/,
  );
});

test("workspace checks reject stale notes and stable tag mismatches while allowing development packages", async (t) => {
  const f = fixture(t);
  f.first();
  f.second();
  renderReleaseNotes(f);
  await assert.rejects(
    checkReleaseNotes({ ...f, tag: "v8.3.2" }),
    /Release tag differs/,
  );
  f.write("release.md", "Stale release notes");
  await assert.rejects(
    checkReleaseNotes({ ...f, notes: path.join(f.workspace, "release.md") }),
    /artifact differs/,
  );
  renderReleaseNotes(f);
  for (const [extension, name] of Object.entries(extensions))
    f.write(
      `vscode/${extension}/package.json`,
      JSON.stringify({
        name,
        publisher: "redhat",
        version: "8.3.1-dev.20261009.abcdef",
      }),
    );
  await checkReleaseNotes(f);
  await assert.rejects(
    checkReleaseNotes({ ...f, tag: "v8.3.1" }),
    /stable version/,
  );
  f.write("vscode/core/CHANGELOG.md", "Upstream notes only");
  await assert.rejects(checkReleaseNotes(f), /stale or missing MTA notes/);
});

test("all eleven packaged changelogs and manifest assets are verified, including six C# targets", async (t) => {
  const f = fixture(t);
  f.first();
  f.second();
  const rendered = renderReleaseNotes(f);
  const dist = path.join(f.root, "dist");
  fs.mkdirSync(dist);
  for (const [extension, name] of Object.entries(extensions)) {
    const staging = path.join(f.root, "stage", name);
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(
      path.join(staging, "package.json"),
      JSON.stringify({
        name,
        publisher: "redhat",
        version: "8.3.1",
        engines: { vscode: "^1.93.0" },
        repository: "https://github.com/migtools/editor-extensions",
      }),
    );
    fs.writeFileSync(path.join(staging, "README.md"), "Fixture");
    fs.writeFileSync(path.join(staging, "LICENSE.md"), "Fixture license");
    fs.writeFileSync(
      path.join(staging, "CHANGELOG.md"),
      rendered[`vscode/${extension}/CHANGELOG.md`],
    );
    for (const target of extension === "csharp" ? targets : [undefined]) {
      await createVSIX({
        cwd: staging,
        dependencies: false,
        target,
        packagePath: path.join(
          dist,
          `${name}${target ? `@${target}` : ""}.vsix`,
        ),
      });
    }
  }
  await checkReleaseNotes({ ...f, dist, tag: "v8.3.1" });
  const staging = path.join(f.root, "stage/mta-core");
  fs.writeFileSync(path.join(staging, "CHANGELOG.md"), "# Upstream 0.8.0\n");
  await createVSIX({
    cwd: staging,
    dependencies: false,
    packagePath: path.join(dist, "mta-core.vsix"),
  });
  await assert.rejects(
    checkReleaseNotes({ ...f, dist }),
    /bundled changelog differs/,
  );
  fs.rmSync(path.join(staging, "CHANGELOG.md"));
  await createVSIX({
    cwd: staging,
    dependencies: false,
    packagePath: path.join(dist, "mta-core.vsix"),
  });
  await assert.rejects(
    checkReleaseNotes({ ...f, dist }),
    /changelog manifest asset required/,
  );
  fs.rmSync(path.join(dist, "mta-core.vsix"));
  await assert.rejects(checkReleaseNotes({ ...f, dist }), /Expected 11 VSIX/);
});

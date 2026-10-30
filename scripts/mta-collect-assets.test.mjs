import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { assetCollectionArgs, collectRulesets } from "./mta-collect-assets.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mta-rulesets-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ref = "a".repeat(40);
  fs.writeFileSync(
    path.join(root, "mta-build.yaml"),
    stringify({
      runtimeAssets: { releaseTag: "v0.11.0" },
      rulesets: {
        repository: "konveyor/rulesets",
        ref,
        semanticRef: "release-0.11",
      },
    }),
  );
  const assets = path.join(root, "downloaded_assets");
  fs.mkdirSync(path.join(assets, "rulesets-java"), { recursive: true });
  fs.writeFileSync(
    path.join(assets, "rulesets-java/stale.yaml"),
    "old beta rule",
  );
  const metadataPath = path.join(assets, "collect-assets-meta.json");
  const original = {
    actions: [
      { id: "provider binaries", meta: { releaseTag: "v0.11.0-beta.1" } },
      { id: "seed rulesets", meta: { releaseTag: "v0.11.0-beta.1" } },
    ],
  };
  fs.writeFileSync(metadataPath, JSON.stringify(original));
  const prefix = "konveyor-rulesets-aaaaaaa";
  const files = Object.fromEntries(
    ["java", "nodejs", "dotnet", "go"].flatMap((language) => [
      [
        `${prefix}/stable/${language}/migration/ruleset.yaml`,
        `name: ${language}\n`,
      ],
      [
        `${prefix}/stable/${language}/migration/rules.yml`,
        `- ruleID: ${language}-001\n`,
      ],
      [
        `${prefix}/stable/${language}/migration/tests/fixture.yaml`,
        "do not bundle",
      ],
    ]),
  );
  files[`${prefix}/preview/ruleset.yaml`] = "name: preview\n";
  files[`${prefix}/docs/ignored.yaml`] = "do not bundle";
  const archivePath = path.join(root, "rulesets.zip");
  const archive = () =>
    execFileSync("python3", [
      "-c",
      "import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1], 'w') as z:\n for name, content in json.loads(sys.argv[2]).items(): z.writestr(name, content)",
      archivePath,
      JSON.stringify(files),
    ]);
  return {
    root,
    assets,
    files,
    prefix,
    ref,
    metadataPath,
    original,
    archivePath,
    archive,
  };
}

test("provider collection defaults to the configured GA release and forwards CLI options", (t) => {
  const { root } = fixture(t);
  assert.deepEqual(
    assetCollectionArgs({
      root,
      args: ["--use-release", "--ruleset-org", "konveyor"],
    }),
    ["--release-tag", "v0.11.0", "--use-release", "--ruleset-org", "konveyor"],
  );
});

test("pinned rulesets replace beta rules in every language and preview without changing providers", async (t) => {
  const f = fixture(t);
  f.archive();
  const meta = await collectRulesets(f);
  assert.equal(meta.commitId, f.ref);
  for (const language of ["java", "nodejs", "dotnet", "go"]) {
    const directory = path.join(f.assets, `rulesets-${language}/migration`);
    assert.equal(
      fs.readFileSync(path.join(directory, "rules.yml"), "utf8"),
      `- ruleID: ${language}-001\n`,
    );
    assert.equal(fs.existsSync(path.join(directory, "tests")), false);
    assert.equal(meta.files[language].length, 2);
  }
  assert.equal(
    fs.existsSync(path.join(f.assets, "rulesets-java/stale.yaml")),
    false,
  );
  assert.equal(
    fs.readFileSync(path.join(f.assets, "rulesets/ruleset.yaml"), "utf8"),
    "name: preview\n",
  );
  assert.equal(fs.existsSync(path.join(f.assets, "docs")), false);
  const metadata = JSON.parse(fs.readFileSync(f.metadataPath, "utf8"));
  assert.deepEqual(metadata.actions[0], f.original.actions[0]);
  assert.equal(metadata.actions[1].meta.commitId, f.ref);
  assert.match(metadata.actions[1].meta.sourceCode.sha256, /^[a-f0-9]{64}$/);
});

test("missing language rulesets fail before replacing any existing assets or provenance", async (t) => {
  const f = fixture(t);
  for (const file of Object.keys(f.files))
    if (file.includes("/stable/go/")) delete f.files[file];
  f.archive();
  await assert.rejects(collectRulesets(f), /No go rulesets/);
  assert.equal(
    fs.readFileSync(path.join(f.assets, "rulesets-java/stale.yaml"), "utf8"),
    "old beta rule",
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(f.metadataPath, "utf8")),
    f.original,
  );
  assert.equal(
    fs.readdirSync(f.assets).some((file) => file.startsWith(".mta-rulesets-")),
    false,
  );
});

test("ruleset collection rejects mutable refs and unsafe archive paths", async (t) => {
  const f = fixture(t);
  f.files[`${f.prefix}/stable/java/../../escape.yaml`] = "unsafe";
  f.archive();
  await assert.rejects(collectRulesets(f), /Unsafe ruleset archive path/);
  fs.writeFileSync(
    path.join(f.root, "mta-build.yaml"),
    stringify({
      rulesets: { repository: "konveyor/rulesets", ref: "release-0.11" },
    }),
  );
  await assert.rejects(collectRulesets(f), /immutable commit SHA/);
});

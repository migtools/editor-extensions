#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import unzipper from "unzipper";
import { parse } from "yaml";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const destinations = {
  java: "rulesets-java",
  nodejs: "rulesets-nodejs",
  dotnet: "rulesets-dotnet",
  go: "rulesets-go",
  preview: "rulesets",
};

export async function collectRulesets({
  root = projectRoot,
  archivePath,
} = {}) {
  const { rulesets } = parse(
    fs.readFileSync(path.join(root, "mta-build.yaml"), "utf8"),
  );
  assert.match(rulesets?.repository ?? "", /^[\w.-]+\/[\w.-]+$/);
  assert.match(
    rulesets?.ref ?? "",
    /^[a-f0-9]{40}$/,
    "Rulesets must use an immutable commit SHA",
  );
  const url = `https://api.github.com/repos/${rulesets.repository}/zipball/${rulesets.ref}`;
  let archive;
  if (archivePath) {
    archive = fs.readFileSync(archivePath);
  } else {
    const headers = process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {};
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(120_000),
    });
    assert.ok(response.ok, `Ruleset download failed: HTTP ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
  }

  const assets = path.join(root, "downloaded_assets");
  const metadataPath = path.join(assets, "collect-assets-meta.json");
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const stage = fs.mkdtempSync(path.join(assets, ".mta-rulesets-"));
  const files = Object.fromEntries(
    Object.keys(destinations).map((language) => [language, []]),
  );
  try {
    const zip = await unzipper.Open.buffer(archive);
    for (const entry of zip.files) {
      if (entry.type !== "File" || !/\.ya?ml$/i.test(entry.path)) continue;
      const parts = entry.path.split("/");
      assert.ok(
        parts.every(
          (part) =>
            part && part !== "." && part !== ".." && !part.includes("\\"),
        ),
        `Unsafe ruleset archive path: ${entry.path}`,
      );
      const [, directory, language] = parts;
      const key =
        directory === "preview"
          ? "preview"
          : directory === "stable"
            ? language
            : null;
      if (!Object.hasOwn(destinations, key)) continue;
      const relative = parts.slice(key === "preview" ? 2 : 3);
      if (!relative.length || relative.includes("tests")) continue;
      const target = path.join(stage, destinations[key], ...relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await entry.buffer());
      files[key].push(relative.join("/"));
    }
    for (const [language, selected] of Object.entries(files)) {
      assert.ok(
        selected.length,
        `No ${language} rulesets found at ${rulesets.ref}`,
      );
      assert.ok(
        selected.some((file) => path.basename(file) === "ruleset.yaml"),
        `No ${language} ruleset descriptor found at ${rulesets.ref}`,
      );
    }
    for (const directory of Object.values(destinations)) {
      const target = path.join(assets, directory);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(path.join(stage, directory), target);
    }
    const [org, repo] = rulesets.repository.split("/");
    const meta = {
      org,
      repo,
      commitId: rulesets.ref,
      semanticRef: rulesets.semanticRef,
      sourceCode: {
        url,
        sha256: createHash("sha256").update(archive).digest("hex"),
      },
      files,
    };
    const previous = metadata.actions.findIndex(
      (action) => action.id === "seed rulesets",
    );
    const action = { id: "seed rulesets", meta };
    if (previous < 0) metadata.actions.push(action);
    else metadata.actions[previous] = action;
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(
      `MTA rulesets: ${rulesets.repository}@${rulesets.ref} (${rulesets.semanticRef})`,
    );
    for (const [language, selected] of Object.entries(files))
      console.log(`  ${destinations[language]}: ${selected.length} rule files`);
    return meta;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // Preserve upstream provider pins and forward all asset-collection CLI options.
  execFileSync(
    process.execPath,
    [
      path.join(projectRoot, "scripts/collect-assets.js"),
      ...process.argv.slice(2),
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );
  await collectRulesets();
}

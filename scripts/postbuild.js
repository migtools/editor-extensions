#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  extensionVersion,
  publisher,
  author,
  shortName,
  repositoryUrl,
  bugsUrl,
} from "./prebuild.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// MTA extension names (must match prebuild.js)
const CORE_NAME = "mta-core";
const PACK_NAME = "mta-vscode-extension";
const LANG_EXTENSIONS = {
  java: "mta-java",
  javascript: "mta-javascript",
  go: "mta-go",
  csharp: "mta-csharp",
};

const errors = [];
const warnings = [];

function readJson(relPath) {
  const fullPath = path.join(__dirname, "..", relPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function writeJson(relPath, data) {
  const fullPath = path.join(__dirname, "..", relPath);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
}

function check(condition, errorMsg) {
  if (!condition) {
    errors.push(errorMsg);
    return false;
  }
  return true;
}

// ─── Version Verification ────────────────────────────────────────────────────
// Version is set by prebuild.js (before webpack) so EXTENSION_VERSION constants
// are baked correctly at compile time. Here we just verify it stuck.

console.log(`📝 Verifying version ${extensionVersion} across workspaces...`);

const workspaces = [
  "vscode/core/package.json",
  "vscode/java/package.json",
  "vscode/javascript/package.json",
  "vscode/go/package.json",
  "vscode/csharp/package.json",
  "vscode/konveyor/package.json",
];

for (const ws of workspaces) {
  const fullPath = path.join(__dirname, "..", ws);
  if (fs.existsSync(fullPath)) {
    const pkg = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    check(
      pkg.version === extensionVersion,
      `${ws} version: expected "${extensionVersion}", got "${pkg.version}"`,
    );
  }
}

console.log("📝 Version verification complete!\n");

// ─── Core Extension Verification ────────────────────────────────────────────

console.log("🔍 Verifying core extension branding...");

const corePkg = readJson("vscode/core/package.json");

// Core metadata
check(corePkg.name === CORE_NAME, `Core name: expected "${CORE_NAME}", got "${corePkg.name}"`);
check(
  corePkg.displayName === "Migration Toolkit for Applications - Core",
  `Core displayName: expected "Migration Toolkit for Applications - Core", got "${corePkg.displayName}"`,
);
check(corePkg.publisher === publisher, `Core publisher: expected "${publisher}", got "${corePkg.publisher}"`);
check(corePkg.author === author, `Core author: expected "${author}", got "${corePkg.author}"`);
check(
  corePkg.description?.includes("Migration Toolkit for Applications (MTA)"),
  "Core description should include 'Migration Toolkit for Applications (MTA)'",
);
check(
  corePkg.repository?.url === repositoryUrl,
  `Core repository URL: expected "${repositoryUrl}", got "${corePkg.repository?.url}"`,
);
check(
  corePkg.bugs === bugsUrl,
  `Core bugs URL: expected "${bugsUrl}", got "${corePkg.bugs}"`,
);

console.log(`  ✅ Core metadata verified`);

// Commands
const commands = corePkg.contributes?.commands || [];
let cmdErrors = 0;
for (const cmd of commands) {
  if (!cmd.command.startsWith(`${CORE_NAME}.`)) {
    errors.push(`Command has wrong prefix: ${cmd.command}`);
    cmdErrors++;
  }
  if (cmd.category !== shortName && cmd.category !== "diffEditor") {
    errors.push(`Command "${cmd.command}" has wrong category: ${cmd.category}`);
    cmdErrors++;
  }
}
if (cmdErrors === 0) {
  console.log(`  ✅ All ${commands.length} commands properly branded`);
}

// Configuration properties
const configProps = corePkg.contributes?.configuration?.properties || {};
let configErrors = 0;
for (const key of Object.keys(configProps)) {
  if (!key.startsWith(`${CORE_NAME}.`)) {
    errors.push(`Config property has wrong prefix: ${key}`);
    configErrors++;
  }
}
if (configErrors === 0) {
  console.log(`  ✅ All ${Object.keys(configProps).length} config properties properly branded`);
}
check(
  corePkg.contributes?.configuration?.title === shortName,
  `Config title: expected "${shortName}", got "${corePkg.contributes?.configuration?.title}"`,
);

// Views and containers
const activitybar = corePkg.contributes?.viewsContainers?.activitybar || [];
for (const container of activitybar) {
  check(container.id === CORE_NAME, `Activity bar container id: expected "${CORE_NAME}", got "${container.id}"`);
  check(container.title === shortName, `Activity bar container title: expected "${shortName}", got "${container.title}"`);
}
console.log(`  ✅ Activity bar containers verified`);

const views = corePkg.contributes?.views || {};
for (const viewKey of Object.keys(views)) {
  check(viewKey === CORE_NAME, `View container key: expected "${CORE_NAME}", got "${viewKey}"`);
  for (const view of views[viewKey]) {
    check(view.id.startsWith(`${CORE_NAME}.`), `View id has wrong prefix: ${view.id}`);
  }
}
console.log(`  ✅ Views verified`);

// Submenus
const submenus = corePkg.contributes?.submenus || [];
for (const submenu of submenus) {
  check(submenu.id.startsWith(CORE_NAME), `Submenu id has wrong prefix: ${submenu.id}`);
  check(
    submenu.label.includes(shortName),
    `Submenu label should include "${shortName}", got "${submenu.label}"`,
  );
}
if (submenus.length > 0) {
  console.log(`  ✅ Submenus verified`);
}

// Fallback assets
if (corePkg.fallbackAssets) {
  const assetCount = Object.keys(corePkg.fallbackAssets.assets || {}).length;
  if (assetCount >= 6) {
    console.log(`  ✅ Fallback assets configured for ${assetCount} platforms`);
  } else {
    warnings.push(`Only ${assetCount} platforms in fallback assets (expected 6)`);
  }
  check(
    corePkg.fallbackAssets.sha256sumFile === "SHA256SUM",
    `sha256sumFile: expected "SHA256SUM", got "${corePkg.fallbackAssets.sha256sumFile}"`,
  );
} else {
  warnings.push("No fallback assets configuration found on core extension");
}

// Activation events — orphaned ones should be removed
if (corePkg.activationEvents) {
  for (const ev of corePkg.activationEvents) {
    if (ev === "onFileSystem:konveyorMemFs" || ev === "onFileSystem:konveyorReadOnly") {
      warnings.push(`Orphaned activation event not removed: ${ev}`);
    }
  }
}

// README
const readmePath = path.join(__dirname, "..", "vscode/core/README.md");
if (fs.existsSync(readmePath)) {
  console.log(`  ✅ README exists for core extension`);
} else {
  warnings.push("README.md not found for core extension");
}

// ─── Language Extension Verification ────────────────────────────────────────

console.log("\n🔍 Verifying language extensions...");

for (const [lang, expectedName] of Object.entries(LANG_EXTENSIONS)) {
  const pkgPath = `vscode/${lang}/package.json`;
  const pkg = readJson(pkgPath);

  check(pkg.name === expectedName, `${lang} name: expected "${expectedName}", got "${pkg.name}"`);
  check(pkg.publisher === publisher, `${lang} publisher: expected "${publisher}", got "${pkg.publisher}"`);
  check(pkg.author === author, `${lang} author: expected "${author}", got "${pkg.author}"`);

  // coreExtensionId
  const expectedCoreId = `${publisher}.${CORE_NAME}`;
  check(
    pkg.coreExtensionId === expectedCoreId,
    `${lang} coreExtensionId: expected "${expectedCoreId}", got "${pkg.coreExtensionId}"`,
  );

  // extensionDependencies should include the MTA core, not konveyor core
  if (pkg.extensionDependencies) {
    check(
      pkg.extensionDependencies.includes(expectedCoreId),
      `${lang} extensionDependencies should include "${expectedCoreId}"`,
    );
    check(
      !pkg.extensionDependencies.includes("konveyor.konveyor-core"),
      `${lang} extensionDependencies still contains "konveyor.konveyor-core"`,
    );
  }

  console.log(`  ✅ ${lang} extension verified: ${pkg.name}`);
}

// ─── Extension Pack Verification ────────────────────────────────────────────

console.log("\n🔍 Verifying extension pack...");

const packPkg = readJson("vscode/konveyor/package.json");

check(packPkg.name === PACK_NAME, `Pack name: expected "${PACK_NAME}", got "${packPkg.name}"`);
check(packPkg.publisher === publisher, `Pack publisher: expected "${publisher}", got "${packPkg.publisher}"`);

if (packPkg.extensionPack) {
  const expectedPackEntries = [
    `${publisher}.${CORE_NAME}`,
    ...Object.values(LANG_EXTENSIONS).map((n) => `${publisher}.${n}`),
  ];
  for (const entry of expectedPackEntries) {
    check(
      packPkg.extensionPack.includes(entry),
      `Extension pack missing entry: ${entry}`,
    );
  }
  // Ensure no konveyor entries remain
  for (const entry of packPkg.extensionPack) {
    check(
      !entry.includes("konveyor"),
      `Extension pack still contains konveyor entry: ${entry}`,
    );
  }
  console.log(`  ✅ Extension pack entries verified: ${packPkg.extensionPack.join(", ")}`);
}

// ─── Source Code Verification ───────────────────────────────────────────────

console.log("\n🔍 Verifying source code transformations...");

const commandsPath = path.join(__dirname, "..", "vscode/core/src/commands.ts");
if (fs.existsSync(commandsPath)) {
  const content = fs.readFileSync(commandsPath, "utf8");
  check(
    !content.includes('"konveyor.konveyor-'),
    "commands.ts still contains 'konveyor.konveyor-' extension IDs",
  );
  console.log("  ✅ commands.ts verified — no konveyor extension IDs remain");
} else {
  warnings.push("commands.ts not found for source code verification");
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n📊 Verification Summary:");
console.log(`  Core: ${CORE_NAME}`);
console.log(`  Languages: ${Object.values(LANG_EXTENSIONS).join(", ")}`);
console.log(`  Pack: ${PACK_NAME}`);
console.log(`  Version: ${extensionVersion}`);

if (warnings.length > 0) {
  console.log(`\n⚠️  Warnings (${warnings.length}):`);
  for (const [i, warning] of warnings.entries()) {
    console.log(`  ${i + 1}. ${warning}`);
  }
}

if (errors.length > 0) {
  console.log(`\n❌ Errors (${errors.length}):`);
  for (const [i, error] of errors.entries()) {
    console.log(`  ${i + 1}. ${error}`);
  }
  console.log("\n❌ Postbuild verification failed!");
  process.exit(1);
} else {
  console.log(`\n✅ Postbuild verification passed! All 6 extensions properly branded.`);
}

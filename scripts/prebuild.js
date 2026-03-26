#!/usr/bin/env node

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── MTA Branding Constants ─────────────────────────────────────────────────

export const extensionVersion = "8.1.0";
export const publisher = "redhat";
export const author = "Red Hat";
export const shortName = "MTA";
export const repositoryUrl = "https://github.com/migtools/editor-extensions";
export const bugsUrl = "https://github.com/migtools/editor-extensions/issues";
export const homepageUrl = "https://developers.redhat.com/products/mta/overview";
export const fallbackAssetsUrl = "https://developers.redhat.com/content-gateway/rest/browse/pub/mta/8.1.0/"

// ─── PRE-RELEASE ASSET HANDLING (uncomment for next pre-release cycle) ──────
// To use candidate/internal assets during pre-release, uncomment the following
// and update the fallbackAssetsUrl above to point to the candidate URL:
//   export const fallbackAssetsUrl = "https://download.devel.redhat.com/devel/candidates/middleware/migrationtoolkit/MTA-X.Y.Z.CRn/"
// const isPreRelease = fallbackAssetsUrl.includes('candidates') || fallbackAssetsUrl.includes('CR');
//
// NOTE: Candidate servers use "SHA256SUM", GA public servers use "sha256sum.txt".
// When switching to pre-release, also update sha256sumFile references below.
// ─────────────────────────────────────────────────────────────────────────────

// Extension name mapping: upstream → downstream
const NAME_MAP = {
  "konveyor-core": "mta-core",
  "konveyor-java": "mta-java",
  "konveyor-javascript": "mta-javascript",
  "konveyor-go": "mta-go",
  "konveyor-csharp": "mta-csharp",
  konveyor: "mta-vscode-extension",
};

// Display name mapping
const DISPLAY_NAME_MAP = {
  "mta-core": "Migration Toolkit for Applications - Core",
  "mta-java": "Migration Toolkit for Applications - Java",
  "mta-javascript": "Migration Toolkit for Applications - JavaScript",
  "mta-go": "Migration Toolkit for Applications - Go",
  "mta-csharp": "Migration Toolkit for Applications - C#",
  "mta-vscode-extension": "Migration Toolkit for Applications",
};

// ─── Shared Metadata ────────────────────────────────────────────────────────

const sharedMeta = {
  publisher,
  author,
  repository: { type: "git", url: repositoryUrl },
  bugs: bugsUrl,
  homepage: homepageUrl,
};

// ─── Utility Functions ──────────────────────────────────────────────────────

function readPackageJson(relPath) {
  const fullPath = path.join(__dirname, "..", relPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function writePackageJson(relPath, data) {
  const fullPath = path.join(__dirname, "..", relPath);
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
}

function mtaName(upstreamName) {
  return NAME_MAP[upstreamName] || upstreamName;
}

function mtaExtensionId(upstreamId) {
  // "konveyor.konveyor-core" → "redhat.mta-core"
  const [, name] = upstreamId.split(".");
  return `${publisher}.${mtaName(name)}`;
}

/** Replace a command/config key prefix: "konveyor-core.foo" → "mta-core.foo" */
function replacePrefix(str) {
  for (const [from, to] of Object.entries(NAME_MAP)) {
    const regex = new RegExp(`^${escapeRegExp(from)}\\.`, "");
    if (regex.test(str)) {
      return str.replace(regex, `${to}.`);
    }
  }
  return str;
}

/** Replace brand words in arbitrary text */
function replaceBrandWord(str) {
  return str.replace(/\bKonveyor\b/g, shortName);
}

/** Replace brand references in viewsWelcome contents (markdown with embedded command URIs) */
function replaceWelcomeContents(str) {
  let result = str;
  // Replace publisher-qualified extension IDs (e.g., konveyor.konveyor → redhat.mta-vscode-extension)
  for (const [from, to] of Object.entries(NAME_MAP)) {
    result = result.replaceAll(`konveyor.${from}`, `${publisher}.${to}`);
  }
  // Replace URL-encoded publisher search queries
  result = result.replaceAll("%40publisher%3Akonveyor", `%40publisher%3A${publisher}`);
  // Replace hyphenated name prefixes (e.g., konveyor-core. → mta-core.)
  // Skip plain "konveyor" to avoid breaking URLs like konveyor.io
  for (const [from, to] of Object.entries(NAME_MAP)) {
    if (from.includes("-")) {
      result = result.replaceAll(`${from}.`, `${to}.`);
    }
  }
  // Replace brand word (Konveyor → MTA)
  result = replaceBrandWord(result);
  return result;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      })
      .on("error", reject);
  });
}

// ─── Core Extension Branding ────────────────────────────────────────────────

function brandCoreExtension(pkg) {
  const coreName = NAME_MAP["konveyor-core"];

  Object.assign(pkg, {
    name: coreName,
    displayName: DISPLAY_NAME_MAP[coreName],
    description:
      "Migration Toolkit for Applications (MTA) - An enterprise migration and modernization tool with optional generative AI features",
    ...sharedMeta,
  });

  // Remove orphaned activation events
  if (pkg.activationEvents) {
    pkg.activationEvents = pkg.activationEvents.filter(
      (ev) => ev !== "onFileSystem:konveyorMemFs" && ev !== "onFileSystem:konveyorReadOnly",
    );
    if (pkg.activationEvents.length === 0) {
      delete pkg.activationEvents;
    }
  }

  // Transform commands
  if (pkg.contributes?.commands) {
    const preservedCategories = ["diffEditor"];
    pkg.contributes.commands = pkg.contributes.commands.map((cmd) => ({
      ...cmd,
      command: replacePrefix(cmd.command),
      category: preservedCategories.includes(cmd.category) ? cmd.category : shortName,
      title: cmd.title ? replaceBrandWord(cmd.title) : cmd.title,
    }));
  }

  // Transform configuration properties
  if (pkg.contributes?.configuration?.properties) {
    const props = pkg.contributes.configuration.properties;
    const newProps = {};
    for (const key of Object.keys(props)) {
      newProps[replacePrefix(key)] = props[key];
    }
    pkg.contributes.configuration.properties = newProps;
    pkg.contributes.configuration.title = shortName;
  }

  // Transform views and containers
  if (pkg.contributes?.viewsContainers?.activitybar) {
    pkg.contributes.viewsContainers.activitybar =
      pkg.contributes.viewsContainers.activitybar.map((container) => ({
        ...container,
        id: coreName,
        title: shortName,
      }));
  }

  if (pkg.contributes?.views) {
    const newViews = {};
    for (const viewKey of Object.keys(pkg.contributes.views)) {
      newViews[coreName] = pkg.contributes.views[viewKey].map((view) => ({
        ...view,
        id: replacePrefix(view.id),
        name: replaceBrandWord(view.name),
      }));
    }
    pkg.contributes.views = newViews;
  }

  // Transform menus
  if (pkg.contributes?.menus) {
    const newMenus = {};
    for (const menuKey of Object.keys(pkg.contributes.menus)) {
      // Replace menu key prefix if it starts with a known brand name
      let newMenuKey = menuKey;
      for (const [from, to] of Object.entries(NAME_MAP)) {
        if (menuKey.startsWith(`${from}/`) || menuKey.startsWith(`${from}.`)) {
          newMenuKey = menuKey.replace(new RegExp(`^${escapeRegExp(from)}`), to);
          break;
        }
      }

      newMenus[newMenuKey] = pkg.contributes.menus[menuKey].map((item) => ({
        ...item,
        command: item.command ? replacePrefix(item.command) : item.command,
        when: item.when ? replaceWhenClause(item.when) : item.when,
        submenu: item.submenu ? replaceSubmenuId(item.submenu) : item.submenu,
      }));
    }
    pkg.contributes.menus = newMenus;
  }

  // Transform submenus
  if (pkg.contributes?.submenus) {
    pkg.contributes.submenus = pkg.contributes.submenus.map((submenu) => ({
      ...submenu,
      id: replaceSubmenuId(submenu.id),
      label: `${shortName} Actions`,
    }));
  }

  // Transform viewsWelcome
  if (pkg.contributes?.viewsWelcome) {
    pkg.contributes.viewsWelcome = pkg.contributes.viewsWelcome.map((entry) => ({
      ...entry,
      view: replacePrefix(entry.view),
      when: entry.when ? replaceWhenClause(entry.when) : entry.when,
      contents: entry.contents ? replaceWelcomeContents(entry.contents) : entry.contents,
    }));
  }

  // Remove kai binary assets from package (they'll be downloaded at runtime via fallbackAssets)
  if (pkg.includedAssetPaths?.kai) {
    delete pkg.includedAssetPaths.kai;
    console.log("  ✅ Removed kai binary assets from package (runtime download enabled)");
  }

  return pkg;
}

/** Replace brand prefixes in "when" clauses */
function replaceWhenClause(when) {
  let result = when;
  for (const [from, to] of Object.entries(NAME_MAP)) {
    // Replace "konveyor-core." prefix in when clauses
    result = result.replace(new RegExp(`\\b${escapeRegExp(from)}\\.`, "g"), `${to}.`);
    // Replace whole-word brand references
    result = result.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
  }
  return result;
}

/** Replace submenu ID prefix */
function replaceSubmenuId(id) {
  for (const [from, to] of Object.entries(NAME_MAP)) {
    if (id.startsWith(from)) {
      return id.replace(new RegExp(`^${escapeRegExp(from)}`), to);
    }
  }
  return id;
}

// ─── Language Extension Branding ────────────────────────────────────────────

function brandLanguageExtension(pkg, lang) {
  const upstreamName = `konveyor-${lang}`;
  const newName = NAME_MAP[upstreamName];

  Object.assign(pkg, {
    name: newName,
    displayName: DISPLAY_NAME_MAP[newName],
    icon: "resources/icon.png",
    ...sharedMeta,
  });

  // Update coreExtensionId
  if (pkg.coreExtensionId) {
    pkg.coreExtensionId = `${publisher}.${NAME_MAP["konveyor-core"]}`;
  }

  // Update extensionDependencies
  if (pkg.extensionDependencies) {
    pkg.extensionDependencies = pkg.extensionDependencies.map((dep) => {
      if (dep === "konveyor.konveyor-core") {
        return `${publisher}.${NAME_MAP["konveyor-core"]}`;
      }
      return dep;
    });
  }

  return pkg;
}

// ─── Extension Pack Branding ────────────────────────────────────────────────

function brandExtensionPack(pkg) {
  const packName = NAME_MAP["konveyor"];

  Object.assign(pkg, {
    name: packName,
    displayName: DISPLAY_NAME_MAP[packName],
    description:
      "Migration Toolkit for Applications (MTA) extension pack (core + language support)",
    publisher,
    repository: { type: "git", url: repositoryUrl },
  });

  // Update extensionPack entries
  if (pkg.extensionPack) {
    pkg.extensionPack = pkg.extensionPack.map((entry) => mtaExtensionId(entry));
  }

  return pkg;
}

// ─── Source Code Transformation ─────────────────────────────────────────────

function transformSourceCode() {
  console.log("🔧 Transforming source code...");

  // Transform hardcoded LANGUAGE_EXTENSION_IDS in commands.ts
  const commandsPath = path.join(__dirname, "..", "vscode/core/src/commands.ts");
  if (fs.existsSync(commandsPath)) {
    let content = fs.readFileSync(commandsPath, "utf8");

    const replacements = [
      ['"konveyor.konveyor-javascript"', `"${publisher}.${NAME_MAP["konveyor-javascript"]}"`],
      ['"konveyor.konveyor-java"', `"${publisher}.${NAME_MAP["konveyor-java"]}"`],
      ['"konveyor.konveyor-go"', `"${publisher}.${NAME_MAP["konveyor-go"]}"`],
      ['"konveyor.konveyor-csharp"', `"${publisher}.${NAME_MAP["konveyor-csharp"]}"`],
    ];

    let changed = false;
    for (const [from, to] of replacements) {
      if (content.includes(from)) {
        content = content.replace(from, to);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(commandsPath, content);
      console.log("  ✅ Transformed LANGUAGE_EXTENSION_IDS in commands.ts");
    } else {
      console.warn(
        "  ⚠️  No konveyor extension IDs found in commands.ts (may already be transformed)",
      );
    }
  } else {
    console.warn("  ⚠️  commands.ts not found at expected path");
  }
}

// ─── Fallback Assets ────────────────────────────────────────────────────────

async function generateFallbackAssets(pkg) {
  console.log("  🔧 Generating fallback assets configuration...");

  const FALLBACK_ASSETS_URL = fallbackAssetsUrl;

  const PLATFORM_MAPPING = {
    "linux-x64": "linux-amd64",
    "linux-arm64": "linux-arm64",
    "darwin-x64": "darwin-amd64",
    "darwin-arm64": "darwin-arm64",
    "win32-x64": "windows-amd64",
    "win32-arm64": "windows-arm64",
  };

  const PLATFORM_BINARY_NAMES = {
    "linux-x64": "mta-analyzer-rpc",
    "linux-arm64": "mta-analyzer-rpc",
    "darwin-x64": "darwin-mta-analyzer-rpc",
    "darwin-arm64": "darwin-mta-analyzer-rpc",
    "win32-x64": "windows-mta-analyzer-rpc",
    "win32-arm64": "windows-mta-analyzer-rpc",
  };

  // Generate static fallback assets based on known URL patterns
  // Used when server is unreachable at build time (e.g., VPN required)
  // The extension will verify availability at runtime
  function generateStaticFallbackAssets() {
    // Extract base version from URL (e.g., "8.1.0" from "MTA-8.1.0.CR2")
    // The analyzer binaries use only the base version, not the release suffix
    const versionMatch = FALLBACK_ASSETS_URL.match(/MTA-(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : "8.1.0";

    const assets = {};
    for (const [vscodePlatform, mtaPlatform] of Object.entries(PLATFORM_MAPPING)) {
      const binaryName = PLATFORM_BINARY_NAMES[vscodePlatform];
      const file = `mta-${version}-analyzer-rpc-${mtaPlatform}.zip`;
      assets[vscodePlatform] = { file, binaryName };
    }
    return assets;
  }

  try {
    console.log(`    Fetching from: ${FALLBACK_ASSETS_URL}`);

    // Verify sha256sum.txt exists
    console.log("    🔍 Verifying sha256sum.txt exists...");
    try {
      const sha256Response = await fetchText(`${FALLBACK_ASSETS_URL}sha256sum.txt`);
      if (!sha256Response || sha256Response.trim().length === 0) {
        throw new Error("sha256sum.txt is empty");
      }
      console.log("      ✅ sha256sum.txt found and not empty");
    } catch (sha256Error) {
      // Pre-release: uncomment to allow builds when VPN-only server is unreachable
      // if (isPreRelease) {
      //   console.warn(`    ⚠️  Failed to fetch checksum: ${sha256Error.message}`);
      //   console.warn("    ⚠️  Server unreachable (VPN required) - using static fallback config");
      //   const assets = generateStaticFallbackAssets();
      //   pkg.fallbackAssets = { baseUrl: FALLBACK_ASSETS_URL, sha256sumFile: "SHA256SUM", assets };
      //   console.log(`  ✅ Generated static fallback assets for ${Object.keys(assets).length} platforms`);
      //   return pkg;
      // }
      console.error(`    ❌ Failed to fetch sha256sum.txt: ${sha256Error.message}`);
      console.error(
        "    ❌ Build failed: sha256sum.txt is required for secure asset downloads",
      );
      process.exit(1);
    }

    // Fetch directory listing
    const html = await fetchText(FALLBACK_ASSETS_URL);
    const allZipFiles = html.match(/mta[^"'\s<>]*analyzer-rpc[^"'\s<>]*\.zip/gi) || [];
    const uniqueFiles = [...new Set(allZipFiles)];

    console.log(
      `    Found ${uniqueFiles.length} analyzer zip files: ${uniqueFiles.join(", ")}`,
    );

    if (uniqueFiles.length === 0) {
      console.error("    ❌ No MTA analyzer zip files found in directory listing");
      console.error("    ❌ Build failed: analyzer binaries are required");
      process.exit(1);
    }

    const assets = {};
    const expectedPlatforms = Object.keys(PLATFORM_MAPPING);
    const foundPlatforms = [];

    for (const file of uniqueFiles) {
      const platformMatch = file.match(/mta-[^-]+-analyzer-rpc-(.+)\.zip$/);
      if (!platformMatch) {
        console.warn(`    Could not extract platform from: ${file}`);
        continue;
      }

      const platform = platformMatch[1];
      const vscodePlatform = Object.entries(PLATFORM_MAPPING).find(
        ([, our]) => our === platform,
      )?.[0];

      if (!vscodePlatform) {
        console.warn(`    No VS Code platform mapping for: ${platform}`);
        continue;
      }

      const binaryName = PLATFORM_BINARY_NAMES[vscodePlatform];
      if (!binaryName) {
        console.warn(`    No binary name for platform: ${vscodePlatform}`);
        continue;
      }

      assets[vscodePlatform] = { file, binaryName };
      foundPlatforms.push(vscodePlatform);
      console.log(`      ✅ ${vscodePlatform}: ${file}`);
    }

    // Verify all platforms found
    const missingPlatforms = expectedPlatforms.filter((p) => !foundPlatforms.includes(p));
    if (missingPlatforms.length > 0) {
      console.error(`    ❌ Missing required platforms: ${missingPlatforms.join(", ")}`);
      console.error("    ❌ Build failed: all platforms must be available");
      process.exit(1);
    }

    pkg.fallbackAssets = {
      baseUrl: FALLBACK_ASSETS_URL,
      sha256sumFile: "sha256sum.txt",
      assets,
    };

    console.log(
      `  ✅ Generated fallback assets for ${Object.keys(assets).length} platforms`,
    );
  } catch (error) {
    // Pre-release: uncomment to fall back to static config when server is unreachable
    // if (isPreRelease) {
    //   console.warn(`  ⚠️  Failed to generate fallback assets: ${error.message}`);
    //   console.warn("  ⚠️  Server unreachable (VPN required) - using static fallback config");
    //   const assets = generateStaticFallbackAssets();
    //   pkg.fallbackAssets = { baseUrl: FALLBACK_ASSETS_URL, sha256sumFile: "SHA256SUM", assets };
    //   console.log(`  ✅ Generated static fallback assets for ${Object.keys(assets).length} platforms`);
    //   return pkg;
    // }
    console.error(`  ❌ Failed to generate fallback assets: ${error.message}`);
    console.error(
      "  ❌ Build failed: fallback assets are required for extension functionality",
    );
    process.exit(1);
  }

  return pkg;
}

// ─── Copy Branding Assets ───────────────────────────────────────────────────

function copyBrandingAssets() {
  console.log("🖼️  Copying branding assets...");

  // 1. Sidebar icon → all extensions
  const iconSource = path.join(__dirname, "..", "assets/branding/sidebar-icons/icon.png");
  const iconTargets = [
    "vscode/core/resources/icon.png",
    "vscode/java/resources/icon.png",
    "vscode/javascript/resources/icon.png",
    "vscode/go/resources/icon.png",
    "vscode/csharp/resources/icon.png",
  ];

  if (fs.existsSync(iconSource)) {
    for (const target of iconTargets) {
      const iconTarget = path.join(__dirname, "..", target);
      fs.copyFileSync(iconSource, iconTarget);
    }
    console.log(`  ✅ VSCode sidebar icon copied to ${iconTargets.length} extensions`);
  } else {
    console.warn("  ⚠️  No sidebar icon found at: assets/branding/sidebar-icons/icon.png");
  }

  // 2. Webview avatar
  const avatarSource = path.join(__dirname, "..", "assets/branding/avatar-icons/avatar.svg");
  const avatarTarget = path.join(__dirname, "..", "webview-ui/public/avatarIcons/avatar.svg");
  if (fs.existsSync(avatarSource)) {
    const avatarDir = path.dirname(avatarTarget);
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }
    fs.copyFileSync(avatarSource, avatarTarget);
    console.log("  ✅ Webview avatar copied");
  } else {
    console.warn("  ⚠️  No avatar found at: assets/branding/avatar-icons/avatar.svg");
  }

  // 3. Branded README → core extension
  const readmeSource = path.join(__dirname, "..", "assets/README.md");
  const readmeTarget = path.join(__dirname, "..", "vscode/core/README.md");
  if (fs.existsSync(readmeSource)) {
    fs.copyFileSync(readmeSource, readmeTarget);
    console.log("  ✅ Branded README copied to core extension");
  } else {
    console.warn("  ⚠️  No branded README found at: assets/README.md");
  }
}

// ─── Main (only runs when executed directly, not when imported) ──────────────

const isDirectExecution =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("/prebuild.js"));

if (isDirectExecution) {
  console.log("🔄 Running MTA prebuild for multi-extension architecture...\n");

  // Pre-release: uncomment to show warning banner during candidate builds
  // if (isPreRelease) {
  //   console.log("🚨🚨🚨 PRE-RELEASE BUILD DETECTED 🚨🚨🚨");
  //   console.log("   Using candidate release assets that require VPN access:");
  //   console.log(`   ${fallbackAssetsUrl}`);
  //   console.log("   Assets will be BUNDLED to avoid runtime download failures");
  //   console.log("🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n");
  // }

  // 0. Set version across all workspaces BEFORE webpack runs
  //    This ensures webpack's DefinePlugin bakes the correct MTA version
  //    into EXTENSION_VERSION constants at compile time.
  console.log(`📝 Setting version ${extensionVersion} across all workspaces...`);
  const workspacePaths = [
    "package.json",
    "extra-types/package.json",
    "shared/package.json",
    "webview-ui/package.json",
    "agentic/package.json",
    "vscode/core/package.json",
    "vscode/java/package.json",
    "vscode/javascript/package.json",
    "vscode/go/package.json",
    "vscode/csharp/package.json",
    "vscode/konveyor/package.json",
  ];

  for (const ws of workspacePaths) {
    const fullPath = path.join(__dirname, "..", ws);
    if (fs.existsSync(fullPath)) {
      const pkg = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      pkg.version = extensionVersion;
      fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2));
      console.log(`  ✅ ${ws}`);
    }
  }
  console.log("");

  // 1. Transform core extension
  console.log("📦 Branding core extension (vscode/core)...");
  let corePkg = readPackageJson("vscode/core/package.json");
  corePkg = brandCoreExtension(corePkg);
  corePkg = await generateFallbackAssets(corePkg);
  writePackageJson("vscode/core/package.json", corePkg);
  console.log(`  ✅ Core extension branded as: ${corePkg.name}\n`);

  // 2. Transform language extensions
  const languages = [
    { dir: "java", lang: "java" },
    { dir: "javascript", lang: "javascript" },
    { dir: "go", lang: "go" },
    { dir: "csharp", lang: "csharp" },
  ];

  for (const { dir, lang } of languages) {
    console.log(`📦 Branding language extension (vscode/${dir})...`);
    let langPkg = readPackageJson(`vscode/${dir}/package.json`);
    langPkg = brandLanguageExtension(langPkg, lang);
    writePackageJson(`vscode/${dir}/package.json`, langPkg);
    console.log(`  ✅ ${lang} extension branded as: ${langPkg.name}\n`);
  }

  // 3. Transform extension pack
  console.log("📦 Branding extension pack (vscode/konveyor)...");
  let packPkg = readPackageJson("vscode/konveyor/package.json");
  packPkg = brandExtensionPack(packPkg);
  writePackageJson("vscode/konveyor/package.json", packPkg);
  console.log(`  ✅ Extension pack branded as: ${packPkg.name}\n`);

  // 4. Transform source code
  transformSourceCode();

  // 5. Copy branding assets
  copyBrandingAssets();

  console.log("\n✅ MTA prebuild complete — all 6 extensions branded.");
}

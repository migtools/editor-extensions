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
// export const fallbackAssetsUrl = "https://developers.redhat.com/content-gateway/rest/browse/pub/mta/8.0.1/"
export const fallbackAssetsUrl = "https://download.devel.redhat.com/devel/candidates/middleware/migrationtoolkit/MTA-8.1.0.CR2/"

// ─── TEMPORARY PRE-RELEASE ASSET HANDLING ───────────────────────────────────
// TODO: REMOVE THIS SECTION WHEN MTA 8.1.0 GOES GA AND ASSETS ARE PUBLIC
// Currently using CR2 (candidate release) which requires VPN access
const isPreRelease = fallbackAssetsUrl.includes('candidates') || fallbackAssetsUrl.includes('CR');
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

  // Asset management strategy for production vs pre-release builds
  if (isPreRelease && pkg.includedAssetPaths?.kai !== undefined) {
    // Pre-release builds: Keep assets bundled to avoid VPN requirements
    console.log("  📦 Keeping kai binary assets bundled (pre-release build)");
    console.log("  🚨 Pre-release mode: Assets bundled to avoid VPN requirement at runtime");
  } else if (!isPreRelease && pkg.includedAssetPaths?.kai !== undefined) {
    // Production builds: Fail hard if dev assets are still bundled
    console.error("  ❌ PRODUCTION BUILD ERROR: Dev assets still bundled!");
    console.error("  ❌ Found bundled kai assets in production build");
    console.error("  ❌ This would ship dev/internal assets to end users");
    console.error("  💡 Solution: Remove kai assets from upstream package.json");
    console.error("     or verify fallbackAssetsUrl points to public release");
    process.exit(1);
  } else if (!isPreRelease) {
    // Production builds: Assets removed, runtime download enabled
    console.log("  ✅ No bundled assets (runtime download from public servers)");
  } else {
    // Pre-release but no assets found
    console.log("  ⚠️  Pre-release mode but no kai assets found");
    console.log("  ⚠️  Extension may fail at runtime without bundled or downloadable assets");
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

  try {
    console.log(`    Fetching from: ${FALLBACK_ASSETS_URL}`);

    // Verify SHA256SUM exists
    console.log("    🔍 Verifying SHA256SUM exists...");
    try {
      const sha256Response = await fetchText(`${FALLBACK_ASSETS_URL}SHA256SUM`);
      if (!sha256Response || sha256Response.trim().length === 0) {
        throw new Error("SHA256SUM is empty");
      }
      console.log("      ✅ SHA256SUM found and not empty");
    } catch (sha256Error) {
      if (isPreRelease) {
        console.warn(`    ⚠️  Failed to fetch SHA256SUM: ${sha256Error.message}`);
        console.warn("    ⚠️  Pre-release build: skipping fallback assets (server unreachable)");
        console.warn("    📦 Assets are bundled, so runtime downloads are not required");
        return pkg;
      }
      console.error(`    ❌ Failed to fetch SHA256SUM: ${sha256Error.message}`);
      console.error(
        "    ❌ Build failed: SHA256SUM is required for secure asset downloads",
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
      sha256sumFile: "SHA256SUM",
      assets,
    };

    console.log(
      `  ✅ Generated fallback assets for ${Object.keys(assets).length} platforms`,
    );
  } catch (error) {
    if (isPreRelease) {
      console.warn(`  ⚠️  Failed to generate fallback assets: ${error.message}`);
      console.warn("  ⚠️  Pre-release build: skipping fallback assets (server unreachable)");
      console.warn("  📦 Assets are bundled, so runtime downloads are not required");
      return pkg;
    }
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

  // 1. Sidebar icon → core extension
  const iconSource = path.join(__dirname, "..", "assets/branding/sidebar-icons/icon.png");
  const iconTarget = path.join(__dirname, "..", "vscode/core/resources/icon.png");
  if (fs.existsSync(iconSource)) {
    fs.copyFileSync(iconSource, iconTarget);
    console.log("  ✅ VSCode sidebar icon copied to core extension");
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

  // Show loud warning for pre-release builds
  if (isPreRelease) {
    console.log("🚨🚨🚨 PRE-RELEASE BUILD DETECTED 🚨🚨🚨");
    console.log("   Using candidate release assets that require VPN access:");
    console.log(`   ${fallbackAssetsUrl}`);
    console.log("   Assets will be BUNDLED to avoid runtime download failures");
    console.log("   📝 TODO: Update to GA URL when MTA 8.1.0 is officially released:");
    console.log("   https://developers.redhat.com/content-gateway/rest/browse/pub/mta/8.1.0/");
    console.log("🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n");
  }

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

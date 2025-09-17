#!/usr/bin/env node

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json to determine which brand we're building
const packagePath = path.join(__dirname, "../vscode/package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

// Use the package name to determine branding, but override to 'mta' for MTA builds
export const extensionName = "mta-vscode-extension";
export const extensionShortName = "MTA";
export const extensionVersion = "8.0.0";

console.log(`🔄 Running prebuild for ${extensionName}...`);

// Generate fallback assets configuration
console.log(`🔧 Generating fallback assets configuration...`);
const FALLBACK_ASSETS_URL =
  "https://developers.redhat.com/content-gateway/rest/browse/pub/mta/8.0.0-Beta/";

// Platform mapping from VS Code naming to our expected naming
const PLATFORM_MAPPING = {
  "linux-x64": "linux-amd64",
  "linux-arm64": "linux-arm64",
  "darwin-x64": "darwin-amd64",
  "darwin-arm64": "darwin-arm64",
  "win32-x64": "windows-amd64",
  "win32-arm64": "windows-arm64",
};

// Binary names for each platform
const PLATFORM_BINARY_NAMES = {
  "linux-x64": "mta-analyzer-rpc",
  "linux-arm64": "mta-analyzer-rpc",
  "darwin-x64": "darwin-mta-analyzer-rpc",
  "darwin-arm64": "darwin-mta-analyzer-rpc",
  "win32-x64": "windows-mta-analyzer-rpc.exe",
  "win32-arm64": "windows-mta-analyzer-rpc.exe",
};

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

try {
  console.log(`Fetching from: ${FALLBACK_ASSETS_URL}`);

  // First, verify sha256sum.txt exists
  console.log("🔍 Verifying sha256sum.txt exists...");
  try {
    const sha256Response = await fetchText(`${FALLBACK_ASSETS_URL}sha256sum.txt`);
    if (!sha256Response || sha256Response.trim().length === 0) {
      throw new Error("sha256sum.txt is empty");
    }
    console.log("  ✅ sha256sum.txt found and not empty");
  } catch (sha256Error) {
    console.error(`❌ Failed to fetch sha256sum.txt: ${sha256Error.message}`);
    console.error("❌ Build failed: sha256sum.txt is required for secure asset downloads");
    process.exit(1);
  }

  // Fetch directory listing to find zip files
  const html = await fetchText(FALLBACK_ASSETS_URL);

  // Just find all .zip files that contain "mta" and "analyzer-rpc"
  const allZipFiles = html.match(/mta[^"'\s<>]*analyzer-rpc[^"'\s<>]*\.zip/gi) || [];
  const uniqueFiles = [...new Set(allZipFiles)];

  console.log(`Found ${uniqueFiles.length} analyzer zip files: ${uniqueFiles.join(", ")}`);

  if (uniqueFiles.length === 0) {
    console.error("❌ No MTA analyzer zip files found in directory listing");
    console.error("❌ Build failed: analyzer binaries are required");
    process.exit(1);
  }

  const assets = {};
  const expectedPlatforms = Object.keys(PLATFORM_MAPPING);
  const foundPlatforms = [];

  for (const file of uniqueFiles) {
    // Extract platform from filename like: mta-8.0.0-analyzer-rpc-darwin-amd64.zip
    const platformMatch = file.match(/mta-[^-]+-analyzer-rpc-(.+)\.zip$/);
    if (!platformMatch) {
      console.warn(`Could not extract platform from: ${file}`);
      continue;
    }

    const platform = platformMatch[1];

    // Map to VS Code platform naming
    const vscodePlatform = Object.entries(PLATFORM_MAPPING).find(
      ([, our]) => our === platform,
    )?.[0];

    if (!vscodePlatform) {
      console.warn(`No VS Code platform mapping for: ${platform}`);
      continue;
    }

    const binaryName = PLATFORM_BINARY_NAMES[vscodePlatform];
    if (!binaryName) {
      console.warn(`No binary name for platform: ${vscodePlatform}`);
      continue;
    }

    assets[vscodePlatform] = {
      file: file,
      binaryName: binaryName,
    };

    foundPlatforms.push(vscodePlatform);
    console.log(`  ✅ ${vscodePlatform}: ${file}`);
  }

  // Verify we found all expected platforms
  const missingPlatforms = expectedPlatforms.filter((p) => !foundPlatforms.includes(p));
  if (missingPlatforms.length > 0) {
    console.error(`❌ Missing required platforms: ${missingPlatforms.join(", ")}`);
    console.error(`❌ Expected platforms: ${expectedPlatforms.join(", ")}`);
    console.error(`❌ Found platforms: ${foundPlatforms.join(", ")}`);
    console.error("❌ Build failed: all platforms must be available");
    process.exit(1);
  }

  const fallbackAssets = {
    baseUrl: FALLBACK_ASSETS_URL,
    sha256sumFile: "sha256sum.txt",
    assets: assets,
  };

  packageJson.fallbackAssets = fallbackAssets;
  console.log(`✅ Generated fallback assets for ${Object.keys(assets).length} platforms`);
  console.log(`✅ All required platforms found: ${foundPlatforms.join(", ")}`);
} catch (error) {
  console.error(`❌ Failed to generate fallback assets: ${error.message}`);
  console.error("❌ Build failed: fallback assets are required for extension functionality");
  process.exit(1);
}

console.log(`📦 Transforming package.json...`);

// Define the list of known brands
const knownBrands = ["konveyor", "mta", "mta-vscode-extension"];

// Build regex patterns from the brand list
const brandPattern = knownBrands.join("|");
const brandRegex = new RegExp(brandPattern, "gi");
const brandPrefixRegex = new RegExp(`\\b(${brandPattern})\\.`, "gi");
const brandWordRegex = new RegExp(`\\b(${brandPattern})(?=\\s|$)`, "gi");

// Apply branding transformations
Object.assign(packageJson, {
  name: extensionName,
  displayName: "Developer Lightspeed for MTA",
  description:
    "Developer Lightspeed for Migration Toolkit for Applications (MTA) - An enterprise migration and modernization tool with generative AI",
  homepage: "https://developers.redhat.com/products/mta/overview",
  repository: {
    type: "git",
    url: "https://github.com/migtools/editor-extensions",
  },
  bugs: "https://github.com/migtools/editor-extensions/issues",
  publisher: "redhat",
  author: "Red Hat",
});

// Remove kai binary assets from package (they'll be downloaded at runtime)
delete packageJson.includedAssetPaths.kai;
console.log("✅ Removed kai binary assets from package (runtime download enabled)");

// Transform configuration properties
if (packageJson.contributes?.configuration?.properties) {
  const props = packageJson.contributes.configuration.properties;
  const newProps = {};

  Object.keys(props).forEach((key) => {
    const newKey = key.replace(/^[^.]+\./, `${extensionName}.`);
    newProps[newKey] = props[key];
  });

  packageJson.contributes.configuration.properties = newProps;
  packageJson.contributes.configuration.title = extensionShortName;
}

// Transform commands
if (packageJson.contributes?.commands) {
  // Categories that should not be transformed by branding
  const preservedCategories = ["diffEditor"];

  packageJson.contributes.commands = packageJson.contributes.commands.map((cmd) => ({
    ...cmd,
    command: cmd.command.replace(/^[^.]+\./, `${extensionName}.`),
    // Only transform category if it's not in the preserved list
    category: preservedCategories.includes(cmd.category) ? cmd.category : extensionShortName,
    title: cmd.title?.replace(brandRegex, extensionShortName) || cmd.title,
  }));
}

// Transform views and containers
if (packageJson.contributes?.viewsContainers?.activitybar) {
  packageJson.contributes.viewsContainers.activitybar =
    packageJson.contributes.viewsContainers.activitybar.map((container) => ({
      ...container,
      id: extensionName,
      title: extensionShortName,
      icon: container.icon, // Keep existing icon path - assets will be copied later
    }));
}

if (packageJson.contributes?.views) {
  const newViews = {};
  Object.keys(packageJson.contributes.views).forEach((viewKey) => {
    newViews[extensionName] = packageJson.contributes.views[viewKey].map((view) => ({
      ...view,
      id: view.id.replace(/^[^.]+\./, `${extensionName}.`),
      name: view.name.replace(brandRegex, extensionShortName),
    }));
  });
  packageJson.contributes.views = newViews;
}

// Transform menus
if (packageJson.contributes?.menus) {
  const transformMenuCommands = (menuItems) => {
    return menuItems.map((item) => ({
      ...item,
      command: item.command?.replace(/^[^.]+\./, `${extensionName}.`),
      when: item.when
        ?.replace(brandPrefixRegex, `${extensionName}.`)
        .replace(brandWordRegex, extensionName),
      submenu: item.submenu?.replace(/^[^.]+\./, `${extensionName}.`),
    }));
  };

  const newMenus = {};
  Object.keys(packageJson.contributes.menus).forEach((menuKey) => {
    const newMenuKey = new RegExp(`^(${brandPattern})`, "i").test(menuKey)
      ? menuKey.replace(/^[^.]+/, extensionName)
      : menuKey;
    newMenus[newMenuKey] = transformMenuCommands(packageJson.contributes.menus[menuKey]);
  });
  packageJson.contributes.menus = newMenus;
}

// Transform submenus
if (packageJson.contributes?.submenus) {
  packageJson.contributes.submenus = packageJson.contributes.submenus.map((submenu) => ({
    ...submenu,
    id: submenu.id.replace(/^[^.]+/, extensionName),
    label: `${extensionShortName} Actions`,
  }));
}

// Write the transformed package.json
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
console.log(`✅ ${extensionShortName} branding transformations complete`);

// Copy assets - whatever exists in the directories gets used
console.log(`🖼️  Copying assets...`);

// 1. Copy VSCode sidebar icon (whatever icon exists in sidebar-icons/)
const iconSource = path.join(__dirname, "..", "assets/branding/sidebar-icons/icon.png");
const iconTarget = path.join(__dirname, "..", "vscode/resources/icon.png");

if (fs.existsSync(iconSource)) {
  fs.copyFileSync(iconSource, iconTarget);
  console.log(`  ✅ VSCode sidebar icon copied`);
} else {
  console.warn(`  ⚠️  No sidebar icon found at: assets/branding/sidebar-icons/icon.png`);
}

// 2. Copy webview avatar (whatever avatar exists in avatar-icons/)
const avatarSource = path.join(__dirname, "..", "assets/branding/avatar-icons/avatar.svg");
const avatarTarget = path.join(__dirname, "..", "webview-ui/public/avatarIcons/avatar.svg");

if (fs.existsSync(avatarSource)) {
  // Ensure target directory exists
  const avatarDir = path.dirname(avatarTarget);
  if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
  }
  fs.copyFileSync(avatarSource, avatarTarget);
  console.log(`  ✅ Webview avatar copied`);
} else {
  console.warn(`  ⚠️  No avatar found at: assets/branding/avatar-icons/avatar.svg`);
}

// 3. Copy branded README
const readmeSource = path.join(__dirname, "..", "assets/README.md");
const readmeTarget = path.join(__dirname, "..", "vscode/README.md");

if (fs.existsSync(readmeSource)) {
  fs.copyFileSync(readmeSource, readmeTarget);
  console.log(`  ✅ Branded README copied`);
} else {
  console.warn(`  ⚠️  No branded README found at: assets/README.md`);
}

console.log(`✅ Prebuild complete for ${extensionName}`);

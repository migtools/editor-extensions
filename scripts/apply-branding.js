#!/usr/bin/env node
/**
 * Apply MTA branding to upstream konveyor extensions.
 *
 * This script reads mta-build.yaml and transforms package.json files
 * for each extension. All extension identity is driven by package.json,
 * which webpack then injects as build-time constants.
 *
 * Usage:
 *   node scripts/apply-branding.js
 *
 * Expected to be run from the upstream workspace root after pull-upstream.js
 * copies this script and mta-build.yaml into place.
 */

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// Load mta-build.yaml
const configPath = path.join(rootDir, "mta-build.yaml");
if (!fs.existsSync(configPath)) {
  console.error("❌ mta-build.yaml not found");
  process.exit(1);
}

const config = parseYaml(fs.readFileSync(configPath, "utf8"));
const { branding, extensions, assets } = config;

console.log("🔄 Applying MTA branding...");
console.log(`   Version: ${branding.version}`);
console.log(`   Publisher: ${branding.publisher}`);
console.log();

// Helper function to fetch text via HTTPS
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

// Platform mappings for fallback assets
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

// Generate fallback assets configuration for core extension
async function generateFallbackAssets(baseUrl) {
  console.log(`   Fetching fallback assets from: ${baseUrl}`);

  // Verify sha256sum.txt exists
  const sha256Response = await fetchText(`${baseUrl}sha256sum.txt`);
  if (!sha256Response || sha256Response.trim().length === 0) {
    throw new Error("sha256sum.txt is empty");
  }
  console.log("   ✅ sha256sum.txt verified");

  // Fetch directory listing
  const html = await fetchText(baseUrl);
  const allZipFiles = html.match(/mta[^"'\s<>]*analyzer-rpc[^"'\s<>]*\.zip/gi) || [];
  const uniqueFiles = [...new Set(allZipFiles)];

  console.log(`   Found ${uniqueFiles.length} analyzer zip files`);

  if (uniqueFiles.length === 0) {
    throw new Error("No MTA analyzer zip files found");
  }

  const assetMap = {};
  const expectedPlatforms = Object.keys(PLATFORM_MAPPING);
  const foundPlatforms = [];

  for (const file of uniqueFiles) {
    const platformMatch = file.match(/mta-[^-]+-analyzer-rpc-(.+)\.zip$/);
    if (!platformMatch) continue;

    const platform = platformMatch[1];
    const vscodePlatform = Object.entries(PLATFORM_MAPPING).find(
      ([, our]) => our === platform
    )?.[0];

    if (!vscodePlatform) continue;

    const binaryName = PLATFORM_BINARY_NAMES[vscodePlatform];
    if (!binaryName) continue;

    assetMap[vscodePlatform] = {
      file: file,
      binaryName: binaryName,
    };
    foundPlatforms.push(vscodePlatform);
  }

  // Verify all platforms found
  const missingPlatforms = expectedPlatforms.filter((p) => !foundPlatforms.includes(p));
  if (missingPlatforms.length > 0) {
    throw new Error(`Missing required platforms: ${missingPlatforms.join(", ")}`);
  }

  console.log(`   ✅ Generated fallback assets for ${Object.keys(assetMap).length} platforms`);

  return {
    baseUrl: baseUrl,
    sha256sumFile: "sha256sum.txt",
    assets: assetMap,
  };
}

// Process each extension
const extensionTypes = ["core", "java", "javascript", "go"];

for (const extType of extensionTypes) {
  const extConfig = extensions[extType];

  if (!extConfig || !extConfig.enabled) {
    console.log(`⏭️  Skipping ${extType} extension (disabled)`);
    continue;
  }

  console.log(`\n📦 Processing ${extType} extension...`);

  const packagePath = path.join(rootDir, `vscode/${extType}/package.json`);

  if (!fs.existsSync(packagePath)) {
    console.warn(`⚠️  Package not found: ${packagePath}`);
    continue;
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  // Apply common branding
  packageJson.name = extConfig.name;
  packageJson.displayName = extConfig.displayName;
  packageJson.description = extConfig.description;
  packageJson.publisher = branding.publisher;
  packageJson.author = branding.author;
  packageJson.version = branding.version;
  packageJson.repository = {
    type: "git",
    url: branding.repository,
  };
  packageJson.bugs = branding.bugs;
  packageJson.homepage = branding.homepage;

  // Update coreExtensionId for language extensions
  if (extType !== "core" && branding.coreExtensionId) {
    packageJson.coreExtensionId = branding.coreExtensionId;

    // Also update extensionDependencies to point to new core extension
    if (packageJson.extensionDependencies) {
      packageJson.extensionDependencies = packageJson.extensionDependencies.map((dep) => {
        // Replace konveyor.konveyor with the branded core extension ID
        if (dep === "konveyor.konveyor") {
          return branding.coreExtensionId;
        }
        return dep;
      });
    }
  }

  // Special handling for CORE extension
  if (extType === "core") {
    const runtimeAssets = extConfig.runtimeAssets || {};

    // Runtime assets mode: download at runtime instead of bundling
    if (runtimeAssets.enabled && runtimeAssets.baseUrl) {
      console.log("   🔧 Runtime assets enabled (download at runtime)");

      // Generate fallback assets config
      try {
        packageJson.fallbackAssets = await generateFallbackAssets(runtimeAssets.baseUrl);
      } catch (error) {
        console.error(`   ❌ Failed to generate fallback assets: ${error.message}`);
        process.exit(1);
      }

      // Remove kai from bundled assets (will be downloaded at runtime)
      if (packageJson.includedAssetPaths?.kai) {
        delete packageJson.includedAssetPaths.kai;
        console.log("   ✅ Removed kai from includedAssetPaths (runtime download)");
      }
    } else {
      console.log("   ℹ️  Using bundled assets from upstream");
    }

    // Transform configuration properties (konveyor.* -> mta-vscode-extension.*)
    if (packageJson.contributes?.configuration?.properties) {
      const props = packageJson.contributes.configuration.properties;
      const newProps = {};

      Object.keys(props).forEach((key) => {
        const newKey = key.replace(/^[^.]+\./, `${extConfig.name}.`);
        newProps[newKey] = props[key];
      });

      packageJson.contributes.configuration.properties = newProps;
      packageJson.contributes.configuration.title = "MTA";
    }

    // Transform commands
    if (packageJson.contributes?.commands) {
      const preservedCategories = ["diffEditor"];

      packageJson.contributes.commands = packageJson.contributes.commands.map((cmd) => ({
        ...cmd,
        command: cmd.command.replace(/^[^.]+\./, `${extConfig.name}.`),
        category: preservedCategories.includes(cmd.category) ? cmd.category : "MTA",
        title: cmd.title?.replace(/konveyor/gi, "MTA") || cmd.title,
      }));
    }

    // Transform views and containers
    if (packageJson.contributes?.viewsContainers?.activitybar) {
      packageJson.contributes.viewsContainers.activitybar =
        packageJson.contributes.viewsContainers.activitybar.map((container) => ({
          ...container,
          id: extConfig.name,
          title: "MTA",
        }));
    }

    if (packageJson.contributes?.views) {
      const newViews = {};
      Object.keys(packageJson.contributes.views).forEach((viewKey) => {
        newViews[extConfig.name] = packageJson.contributes.views[viewKey].map((view) => ({
          ...view,
          id: view.id.replace(/^[^.]+\./, `${extConfig.name}.`),
          name: view.name.replace(/konveyor/gi, "MTA"),
        }));
      });
      packageJson.contributes.views = newViews;
    }

    // Transform menus
    if (packageJson.contributes?.menus) {
      const transformMenuCommands = (menuItems) => {
        return menuItems.map((item) => ({
          ...item,
          command: item.command?.replace(/^[^.]+\./, `${extConfig.name}.`),
          when: item.when
            ?.replace(/\bkonveyor\./gi, `${extConfig.name}.`)
            .replace(/\bkonveyor\b/gi, extConfig.name),
          submenu: item.submenu?.replace(/^[^.]+\./, `${extConfig.name}.`),
        }));
      };

      const newMenus = {};
      Object.keys(packageJson.contributes.menus).forEach((menuKey) => {
        const newMenuKey = /^konveyor/i.test(menuKey)
          ? menuKey.replace(/^[^.]+/, extConfig.name)
          : menuKey;
        newMenus[newMenuKey] = transformMenuCommands(packageJson.contributes.menus[menuKey]);
      });
      packageJson.contributes.menus = newMenus;
    }

    // Transform submenus
    if (packageJson.contributes?.submenus) {
      packageJson.contributes.submenus = packageJson.contributes.submenus.map((submenu) => ({
        ...submenu,
        id: submenu.id.replace(/^[^.]+/, extConfig.name),
        label: "MTA Actions",
      }));
    }
  }

  // Write transformed package.json
  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  console.log(`   ✅ ${extConfig.name} branded successfully`);
}

// Copy MTA-specific assets
console.log("\n🖼️  Copying MTA assets...");

for (const { from, to } of assets) {
  const sourcePath = path.join(rootDir, from);
  const targetPath = path.join(rootDir, to);

  if (fs.existsSync(sourcePath)) {
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`   ✅ ${from} → ${to}`);
  } else {
    console.warn(`   ⚠️  Asset not found: ${from}`);
  }
}

console.log("\n✅ MTA branding complete!");


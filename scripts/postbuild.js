#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extensionName, extensionShortName, extensionVersion } from "./prebuild.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log(`🔍 Running postbuild for ${extensionName}...`);

// First, update all workspace versions
console.log(`📝 Updating all package.json versions to ${extensionVersion}...`);

const workspaces = [
  "../package.json",
  "../extra-types/package.json",
  "../shared/package.json",
  "../webview-ui/package.json",
  "../agentic/package.json",
  "../vscode/package.json",
];

for (const workspacePath of workspaces) {
  const fullPath = path.join(__dirname, workspacePath);
  if (fs.existsSync(fullPath)) {
    const workspacePackage = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    workspacePackage.version = extensionVersion;
    fs.writeFileSync(fullPath, JSON.stringify(workspacePackage, null, 2));
    console.log(`  ✅ Updated ${workspacePath}`);
  }
}

console.log(`📝 Version updates complete!`);

console.log(`🔍 Running postbuild verification for ${extensionName}...`);

// Read the final package.json to verify branding was applied
const packagePath = path.join(__dirname, "../vscode/package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const errors = [];
const warnings = [];

// Verify core package properties
console.log("🔍 Verifying core package properties...");

if (packageJson.name !== extensionName) {
  errors.push(`Expected name: ${extensionName}, got: ${packageJson.name}`);
} else {
  console.log(`  ✅ Package name: ${packageJson.name}`);
}

if (packageJson.displayName !== "Developer Lightspeed for MTA") {
  errors.push(
    `Expected displayName: "Developer Lightspeed for MTA", got: ${packageJson.displayName}`,
  );
} else {
  console.log(`  ✅ Display name: ${packageJson.displayName}`);
}

if (packageJson.publisher !== "redhat") {
  errors.push(`Expected publisher: "redhat", got: ${packageJson.publisher}`);
} else {
  console.log(`  ✅ Publisher: ${packageJson.publisher}`);
}

if (packageJson.author !== "Red Hat") {
  errors.push(`Expected author: "Red Hat", got: ${packageJson.author}`);
} else {
  console.log(`  ✅ Author: ${packageJson.author}`);
}

if (
  !packageJson.description.includes("Developer Lightspeed for Migration Toolkit for Applications")
) {
  errors.push(
    `Description should include "Developer Lightspeed for Migration Toolkit for Applications"`,
  );
} else {
  console.log(`  ✅ Description includes proper branding`);
}

// Verify repository URLs
console.log("🔍 Verifying repository URLs...");

if (packageJson.repository?.url !== "https://github.com/migtools/editor-extensions") {
  errors.push(
    `Expected repository URL: "https://github.com/migtools/editor-extensions", got: ${packageJson.repository?.url}`,
  );
} else {
  console.log(`  ✅ Repository URL: ${packageJson.repository.url}`);
}

if (packageJson.bugs !== "https://github.com/migtools/editor-extensions/issues") {
  errors.push(
    `Expected bugs URL: "https://github.com/migtools/editor-extensions/issues", got: ${packageJson.bugs}`,
  );
} else {
  console.log(`  ✅ Bugs URL: ${packageJson.bugs}`);
}

// Verify commands have correct branding
console.log("🔍 Verifying command branding...");

const commands = packageJson.contributes?.commands || [];
let commandErrors = 0;

commands.forEach((cmd, index) => {
  if (!cmd.command.startsWith(`${extensionName}.`)) {
    errors.push(`Command ${index} has incorrect prefix: ${cmd.command}`);
    commandErrors++;
  }

  if (cmd.category !== extensionShortName && cmd.category !== "diffEditor") {
    errors.push(
      `Command ${index} has incorrect category: ${cmd.category} (expected: ${extensionShortName} or diffEditor)`,
    );
    commandErrors++;
  }
});

if (commandErrors === 0) {
  console.log(`  ✅ All ${commands.length} commands properly branded`);
} else {
  console.log(`  ❌ Found ${commandErrors} command branding issues`);
}

// Verify configuration properties
console.log("🔍 Verifying configuration properties...");

const configProps = packageJson.contributes?.configuration?.properties || {};
const propKeys = Object.keys(configProps);
let configErrors = 0;

propKeys.forEach((key) => {
  if (!key.startsWith(`${extensionName}.`)) {
    errors.push(`Configuration property has incorrect prefix: ${key}`);
    configErrors++;
  }
});

if (configErrors === 0) {
  console.log(`  ✅ All ${propKeys.length} configuration properties properly branded`);
} else {
  console.log(`  ❌ Found ${configErrors} configuration property branding issues`);
}

if (packageJson.contributes?.configuration?.title !== extensionShortName) {
  errors.push(
    `Configuration title should be: ${extensionShortName}, got: ${packageJson.contributes?.configuration?.title}`,
  );
} else {
  console.log(`  ✅ Configuration title: ${packageJson.contributes.configuration.title}`);
}

// Verify views and containers
console.log("🔍 Verifying views and containers...");

const activitybar = packageJson.contributes?.viewsContainers?.activitybar || [];
activitybar.forEach((container, index) => {
  if (container.id !== extensionName) {
    errors.push(`Activity bar container ${index} has incorrect id: ${container.id}`);
  }
  if (container.title !== extensionShortName) {
    errors.push(`Activity bar container ${index} has incorrect title: ${container.title}`);
  }
});

if (activitybar.length > 0) {
  console.log(`  ✅ Activity bar containers properly branded`);
}

// Verify views
const views = packageJson.contributes?.views || {};
Object.keys(views).forEach((viewKey) => {
  if (viewKey !== extensionName) {
    errors.push(`View container key should be: ${extensionName}, got: ${viewKey}`);
  }

  views[viewKey].forEach((view, index) => {
    if (!view.id.startsWith(`${extensionName}.`)) {
      errors.push(`View ${index} has incorrect id prefix: ${view.id}`);
    }
  });
});

console.log(`  ✅ Views properly branded`);

// Verify menus
console.log("🔍 Verifying menus...");

const menus = packageJson.contributes?.menus || {};
Object.keys(menus).forEach((menuKey) => {
  if (
    menuKey.includes(".") &&
    !menuKey.startsWith(`${extensionName}.`) &&
    !menuKey.startsWith("view/") &&
    !menuKey.startsWith("explorer/") &&
    !menuKey.startsWith("commandPalette")
  ) {
    warnings.push(`Menu key might need branding: ${menuKey}`);
  }
});

console.log(`  ✅ Menus verified`);

// Verify submenus
const submenus = packageJson.contributes?.submenus || [];
submenus.forEach((submenu, index) => {
  if (!submenu.id.startsWith(extensionName)) {
    errors.push(`Submenu ${index} has incorrect id: ${submenu.id}`);
  }
  if (!submenu.label.includes(extensionShortName)) {
    errors.push(
      `Submenu ${index} label should include: ${extensionShortName}, got: ${submenu.label}`,
    );
  }
});

if (submenus.length > 0) {
  console.log(`  ✅ Submenus properly branded`);
}

// Verify fallback assets exist
console.log("🔍 Verifying fallback assets...");

if (packageJson.fallbackAssets) {
  const assets = packageJson.fallbackAssets.assets || {};
  const platformCount = Object.keys(assets).length;

  if (platformCount >= 6) {
    console.log(`  ✅ Fallback assets configured for ${platformCount} platforms`);
  } else {
    warnings.push(`Only ${platformCount} platforms configured in fallback assets (expected 6)`);
  }

  if (packageJson.fallbackAssets.sha256sumFile !== "sha256sum.txt") {
    warnings.push(
      `sha256sumFile should be "sha256sum.txt", got: ${packageJson.fallbackAssets.sha256sumFile}`,
    );
  } else {
    console.log(`  ✅ sha256sumFile properly configured`);
  }
} else {
  warnings.push("No fallback assets configuration found");
}

// Verify README was copied
console.log("🔍 Verifying README...");

const readmePath = path.join(__dirname, "../vscode/README.md");
if (fs.existsSync(readmePath)) {
  const readmeContent = fs.readFileSync(readmePath, "utf8");
  if (readmeContent.includes("Developer Lightspeed for migration toolkit")) {
    console.log(`  ✅ README contains proper branding`);
  } else {
    errors.push("README does not contain proper branding");
  }
} else {
  errors.push("README.md not found");
}

// Summary
console.log("\n📊 Verification Summary:");
console.log(`✅ Verified branding for extension: ${extensionName}`);
console.log(`✅ Short name: ${extensionShortName}`);

if (warnings.length > 0) {
  console.log(`\n⚠️  Warnings (${warnings.length}):`);
  warnings.forEach((warning, index) => {
    console.log(`  ${index + 1}. ${warning}`);
  });
}

if (errors.length > 0) {
  console.log(`\n❌ Errors (${errors.length}):`);
  errors.forEach((error, index) => {
    console.log(`  ${index + 1}. ${error}`);
  });
  console.log("\n❌ Postbuild verification failed!");
  process.exit(1);
} else {
  console.log(`\n✅ Postbuild verification passed! ${extensionName} is properly branded.`);
}

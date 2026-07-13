#!/usr/bin/env node

/**
 * Pull upstream konveyor/editor-extensions and prepare for local development
 *
 * Usage:
 *   node scripts/pull-upstream.js
 *   node scripts/pull-upstream.js --ref=release-0.2
 *   node scripts/pull-upstream.js --ref=v0.2.1
 *
 * This script:
 * 1. Reads mta-build.yaml to get upstream repo/ref
 * 2. Clones/updates upstream at .upstream-workspace/
 * 3. Copies MTA config and assets into the workspace
 * 4. Now you can cd .upstream-workspace and run npm ci, npm run build, etc.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { parse: parseYaml } = require("yaml");

const rootDir = path.join(__dirname, "..");

// Parse command line args
const args = process.argv.slice(2);
const refOverride = args.find((arg) => arg.startsWith("--ref="))?.split("=")[1];

// Read build config from mta-build.yaml
const buildConfigPath = path.join(rootDir, "mta-build.yaml");
if (!fs.existsSync(buildConfigPath)) {
  console.error("❌ mta-build.yaml not found");
  process.exit(1);
}

const config = parseYaml(fs.readFileSync(buildConfigPath, "utf8"));
const upstreamRepo = config.upstream.repository;
const upstreamRef = refOverride || config.upstream.ref;
const semanticRef = config.upstream.semanticRef || upstreamRef;
const upstreamUrl = `https://github.com/${upstreamRepo}.git`;

console.log("🔧 MTA Release-0.6 Development Setup");
console.log(`📦 Upstream: ${upstreamRepo}`);
console.log(
  `🏷️  Ref: ${upstreamRef.substring(0, 7)}... (${semanticRef})`
);
if (refOverride) {
  console.log(`   (overridden from command line)`);
}
console.log();

// Workspace directory
const workspaceDir = path.join(rootDir, ".upstream-workspace");

// Step 1: Clone or update upstream
if (fs.existsSync(workspaceDir)) {
  console.log("📂 Workspace exists, updating...");

  try {
    // Fetch latest
    execSync("git fetch origin", { cwd: workspaceDir, stdio: "inherit" });

    // Clean any local changes
    execSync("git reset --hard", { cwd: workspaceDir, stdio: "inherit" });
    execSync("git clean -fd", { cwd: workspaceDir, stdio: "inherit" });

    // Checkout the ref
    execSync(`git checkout ${upstreamRef}`, {
      cwd: workspaceDir,
      stdio: "inherit",
    });

    console.log("✅ Workspace updated\n");
  } catch (error) {
    console.error("❌ Failed to update workspace");
    console.error("   Try deleting .upstream-workspace and running again");
    process.exit(1);
  }
} else {
  console.log("📥 Cloning upstream repository...");

  try {
    execSync(`git clone ${upstreamUrl} ${workspaceDir}`, { stdio: "inherit" });

    execSync(`git checkout ${upstreamRef}`, {
      cwd: workspaceDir,
      stdio: "inherit",
    });

    console.log("✅ Repository cloned\n");
  } catch (error) {
    console.error("❌ Failed to clone repository");
    process.exit(1);
  }
}

// Step 2: Get upstream SHA for provenance
let upstreamSha;
try {
  upstreamSha = execSync("git rev-parse HEAD", {
    cwd: workspaceDir,
    encoding: "utf8",
  }).trim();
  const upstreamShaShort = upstreamSha.substring(0, 7);
  console.log(`📌 Upstream SHA: ${upstreamShaShort} (${upstreamSha})`);
} catch (error) {
  console.error("❌ Failed to get upstream SHA");
  process.exit(1);
}

// Step 3: Copy MTA build config and assets
console.log("\n🎨 Copying MTA overlay files...");

// Copy mta-build.yaml to workspace root
fs.copyFileSync(buildConfigPath, path.join(workspaceDir, "mta-build.yaml"));
console.log("  ✅ Copied mta-build.yaml");

// Copy MTA scripts to scripts/
const prebuildSource = path.join(rootDir, "scripts/prebuild.js");
const prebuildTarget = path.join(workspaceDir, "scripts/prebuild.js");
if (fs.existsSync(prebuildSource)) {
  fs.copyFileSync(prebuildSource, prebuildTarget);
  console.log("  ✅ Copied prebuild.js to scripts/");
}

const postbuildSource = path.join(rootDir, "scripts/postbuild.js");
const postbuildTarget = path.join(workspaceDir, "scripts/postbuild.js");
if (fs.existsSync(postbuildSource)) {
  fs.copyFileSync(postbuildSource, postbuildTarget);
  console.log("  ✅ Copied postbuild.js to scripts/");
}

// Copy assets directory
const assetsSource = path.join(rootDir, "assets");
const assetsTarget = path.join(workspaceDir, "assets");

const copyRecursive = (src, dest) => {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

if (fs.existsSync(assetsSource)) {
  copyRecursive(assetsSource, assetsTarget);
  console.log("  ✅ Copied assets/");
}

// Copy E2E test environment configuration
const envCiSource = path.join(rootDir, "tests", ".env.ci");
const envCiTarget = path.join(workspaceDir, "tests", ".env.ci");
if (fs.existsSync(envCiSource)) {
  if (!fs.existsSync(path.dirname(envCiTarget))) {
    fs.mkdirSync(path.dirname(envCiTarget), { recursive: true });
  }
  fs.copyFileSync(envCiSource, envCiTarget);
  console.log("  ✅ Copied tests/.env.ci for E2E tests");
}

// Step 5: Create a marker file with build info
const buildInfoPath = path.join(workspaceDir, ".mta-build-info.json");
const buildInfo = {
  upstream: {
    repository: upstreamRepo,
    ref: upstreamRef,
    semanticRef: semanticRef,
    sha: upstreamSha,
  },
  preparedAt: new Date().toISOString(),
  architecture: "release-0.6-multi-extension",
};
fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2));

console.log("\n✅ Local development environment ready!");
console.log("\n📋 Next steps:");
console.log("   cd .upstream-workspace");
console.log("   npm ci");
console.log("   npm run build      # Builds with MTA branding");
console.log("   npm run dist       # Prepare distribution");
console.log("   npm run package    # Create VSIX file");
console.log();
console.log(
  "💡 The prebuild step will automatically apply MTA branding during build"
);
console.log();

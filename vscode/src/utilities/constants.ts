// Declare webpack-defined globals
declare const __EXTENSION_NAME__: string;
declare const __EXTENSION_PUBLISHER__: string;
declare const __EXTENSION_VERSION__: string;
declare const __BUILD_GIT_SHA__: string;
declare const __BUILD_GIT_SHA_SHORT__: string;
declare const __BUILD_TIMESTAMP__: string;

import { join } from "path";
import { readFileSync } from "fs";

export const KONVEYOR_SCHEME = "konveyorMemFs";
export const KONVEYOR_READ_ONLY_SCHEME = "konveyorReadOnly";
export const RULE_SET_DATA_FILE_PREFIX = "analysis";
export const PARTIAL_RULE_SET_DATA_FILE_PREFIX = "partial_analysis";
export const MERGED_RULE_SET_DATA_FILE_PREFIX = "merged_analysis";
export const SOLUTION_DATA_FILE_PREFIX = "solution";

// Build-time constants injected by webpack DefinePlugin
export const EXTENSION_NAME = __EXTENSION_NAME__;
export const EXTENSION_PUBLISHER = __EXTENSION_PUBLISHER__;
export const EXTENSION_VERSION = __EXTENSION_VERSION__;
export const BUILD_GIT_SHA = __BUILD_GIT_SHA__;
export const BUILD_GIT_SHA_SHORT = __BUILD_GIT_SHA_SHORT__;
export const BUILD_TIMESTAMP = __BUILD_TIMESTAMP__;

// Convenience: Full extension ID (publisher.name)
export const EXTENSION_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`;

// Convenience: Version with git info for debugging
export const BUILD_INFO = `v${EXTENSION_VERSION} ${BUILD_GIT_SHA} (${BUILD_TIMESTAMP})`;

// Also support runtime loading from package.json as fallback
const packagePath = join(__dirname, "..", "..", "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
export const PACKAGE_NAME = packageJson.name;

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Documentation coverage gate.
 *
 * Every TypeScript source file under the scanned roots must be referenced by
 * its nearest ancestor `README.md`, using the path relative to that README's
 * directory. This keeps module documentation aligned with the code.
 *
 * See `docs/gates/documentation.md`.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SOURCE_ROOTS = ["src", "env"] as const;
const EXCLUDED_DIRECTORIES = new Set(["tests"]);
const TYPESCRIPT_EXTENSION = ".ts";
const README_FILENAME = "README.md";

const toPosix = (value: string): string => value.split(sep).join("/");

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    // A missing or unreadable candidate is simply not a file.
    return false;
  }
};

const collectTypeScriptFiles = (directory: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        files.push(...collectTypeScriptFiles(join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(TYPESCRIPT_EXTENSION)) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
};

const ancestorDirectories = (file: string, moduleRoot: string): string[] => {
  const directories: string[] = [];
  let directory = dirname(file);

  while (directory.startsWith(moduleRoot)) {
    directories.push(directory);

    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }

  return directories;
};

const findOwningReadme = (file: string, moduleRoot: string): string | undefined => {
  for (const directory of ancestorDirectories(file, moduleRoot)) {
    const candidate = join(directory, README_FILENAME);
    if (isFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

const violations: string[] = [];
let checkedFiles = 0;

for (const sourceRoot of SOURCE_ROOTS) {
  const moduleRoot = join(REPO_ROOT, sourceRoot);

  for (const file of collectTypeScriptFiles(moduleRoot)) {
    checkedFiles += 1;
    const location = toPosix(relative(REPO_ROOT, file));
    const readme = findOwningReadme(file, moduleRoot);

    if (readme === undefined) {
      violations.push(`${location}: no ancestor ${README_FILENAME} covers this file`);
      continue;
    }

    const relativePath = toPosix(relative(dirname(readme), file));
    const contents = readFileSync(readme, "utf8");
    if (!contents.includes(relativePath)) {
      violations.push(
        `${location}: not referenced in ${toPosix(relative(REPO_ROOT, readme))}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(
    "Documentation gate failed: every source file must be mapped by its module README.",
  );
  console.error("See docs/gates/documentation.md.");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(
  `Documentation gate passed: ${String(checkedFiles)} source files mapped by module READMEs.`,
);

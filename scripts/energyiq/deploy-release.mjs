#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const BUILD_EXCLUDES = new Set([".git", ".next", "dist", "node_modules"]);

const pathExists = async (value) => {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

const defaultRun = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
  });
});

const defaultCheckHttp = async (url) => {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Smoke check failed (${response.status}): ${url}`);
};

const requireAbsoluteDirectory = async (label, value) => {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  const details = await lstat(value);
  if (!details.isDirectory() && !details.isSymbolicLink()) {
    throw new Error(`${label} must be a directory.`);
  }
};

const requireIndependentBackup = async (appRoot, backupPath) => {
  if (!path.isAbsolute(backupPath)) throw new Error("metadataBackupPath must be an absolute path.");
  await lstat(backupPath);
  const [resolvedAppRoot, resolvedBackupPath] = await Promise.all([
    realpath(appRoot),
    realpath(backupPath),
  ]);
  const relative = path.relative(resolvedAppRoot, resolvedBackupPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Metadata backup must be outside the application root.");
  }
};

const replaceCurrentLink = async (currentLink, nextLink, previousLink) => {
  if (process.platform !== "win32") {
    await rename(nextLink, currentLink);
    return;
  }

  // Windows cannot atomically replace an existing directory junction. This
  // branch exists for local rehearsal only; production Linux uses rename(2).
  await rename(currentLink, previousLink);
  try {
    await rename(nextLink, currentLink);
  } catch (error) {
    await rename(previousLink, currentLink);
    throw error;
  }
  await unlink(previousLink);
};

const createReleaseLink = async (target, linkPath) => {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
};

const smoke = async (urls, checkHttp) => {
  for (const url of urls) await checkHttp(url);
};

const defaultSleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const waitForSmoke = async (urls, checkHttp, options = {}) => {
  const attempts = options.attempts ?? 60;
  const delayMs = options.delayMs ?? 1_000;
  const sleep = options.sleep ?? defaultSleep;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await smoke(urls, checkHttp);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError;
};

const copyReleaseSource = async (sourceDir, stagingDir) => {
  await cp(sourceDir, stagingDir, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const relative = path.relative(sourceDir, source);
      if (!relative) return true;
      const segments = relative.split(path.sep);
      if (segments.some((segment) => BUILD_EXCLUDES.has(segment))) return false;
      return !relative.endsWith(".tsbuildinfo");
    },
  });
};

const requireReleaseIdentityMarkers = async (releaseDir, releaseSha) => {
  const expected = `${releaseSha}\n`;
  const [dotMarker, envMarker] = await Promise.all([
    readFile(path.join(releaseDir, ".release-sha"), "utf8"),
    readFile(path.join(releaseDir, "RELEASE_SHA"), "utf8"),
  ]);
  if (dotMarker !== expected || envMarker !== expected) {
    throw new Error("Release identity markers do not match the intended Git SHA.");
  }
};

export async function deployEnergyIqRelease(input, dependencies = {}) {
  const run = dependencies.run ?? defaultRun;
  const checkHttp = dependencies.checkHttp ?? defaultCheckHttp;
  const smokeAttempts = dependencies.smokeAttempts ?? 60;
  const sleep = dependencies.sleep ?? defaultSleep;
  const releaseSha = input.releaseSha?.trim();
  if (!RELEASE_SHA_PATTERN.test(releaseSha ?? "")) {
    throw new Error("releaseSha must be a lowercase 40-character Git SHA.");
  }
  await requireAbsoluteDirectory("appRoot", input.appRoot);
  await requireAbsoluteDirectory("sourceDir", input.sourceDir);
  await requireIndependentBackup(input.appRoot, input.metadataBackupPath);
  if (!Array.isArray(input.smokeUrls) || input.smokeUrls.length < 3) {
    throw new Error("At least API health, Web login and exact Overview smoke URLs are required.");
  }
  if (!input.apiService || !input.webService) {
    throw new Error("Both API and Web service names are required.");
  }

  const appRoot = await realpath(input.appRoot);
  const sourceDir = await realpath(input.sourceDir);
  const releasesRoot = path.join(appRoot, "releases");
  const currentLink = path.join(appRoot, "current");
  const nextLink = path.join(appRoot, ".current-next");
  const previousLink = path.join(appRoot, ".current-previous");
  const stagingDir = path.join(releasesRoot, `.staging-${releaseSha}`);
  const finalRelease = path.join(releasesRoot, releaseSha);

  await mkdir(releasesRoot, { recursive: true });
  if (await pathExists(stagingDir)) throw new Error(`Staging path already exists: ${stagingDir}`);
  if (await pathExists(finalRelease)) throw new Error(`Release path already exists: ${finalRelease}`);
  if (await pathExists(nextLink) || await pathExists(previousLink)) {
    throw new Error("A previous release-link operation is incomplete; inspect it before retrying.");
  }

  const currentDetails = await lstat(currentLink);
  if (!currentDetails.isSymbolicLink()) throw new Error("current must be a symlink to a physical release directory.");
  const previousRelease = await realpath(currentLink);
  const previousRelative = path.relative(releasesRoot, previousRelease);
  if (previousRelative.startsWith("..") || path.isAbsolute(previousRelative)) {
    throw new Error("current resolves outside the releases directory.");
  }
  if ((await lstat(previousRelease)).isSymbolicLink()) {
    throw new Error("current must resolve to a physical release directory, not another symlink.");
  }

  const sourceIdentity = await run("git", ["-C", sourceDir, "rev-parse", "HEAD"]);
  if (sourceIdentity.stdout.trim() !== releaseSha) {
    throw new Error(`Source HEAD does not match releaseSha: ${sourceIdentity.stdout.trim()}`);
  }
  const sourceStatus = await run("git", ["-C", sourceDir, "status", "--porcelain"]);
  if (sourceStatus.stdout.trim()) {
    throw new Error("Source checkout must be clean before a release can be staged.");
  }

  await smoke(input.smokeUrls, checkHttp);
  await mkdir(stagingDir);
  await copyReleaseSource(sourceDir, stagingDir);
  await writeFile(path.join(stagingDir, ".release-sha"), `${releaseSha}\n`, "utf8");
  await writeFile(path.join(stagingDir, "RELEASE_SHA"), `${releaseSha}\n`, "utf8");
  await run("npm", ["ci"], { cwd: stagingDir });
  await run("npm", ["run", "build", "--", "--force"], { cwd: stagingDir });
  await run("npm", ["run", "build:web"], { cwd: stagingDir });
  await requireReleaseIdentityMarkers(stagingDir, releaseSha);
  await rename(stagingDir, finalRelease);

  const finalDetails = await lstat(finalRelease);
  if (!finalDetails.isDirectory() || finalDetails.isSymbolicLink()) {
    throw new Error("Final release must be a physical directory.");
  }

  await createReleaseLink(finalRelease, nextLink);
  await replaceCurrentLink(currentLink, nextLink, previousLink);
  let switched = true;
  try {
    await run("systemctl", ["restart", input.apiService, input.webService]);
    await waitForSmoke(input.smokeUrls, checkHttp, { attempts: smokeAttempts, sleep });
    switched = false;
  } catch (error) {
    if (switched) {
      if (await pathExists(nextLink)) throw new Error("Rollback refused because the next link still exists.", { cause: error });
      await createReleaseLink(previousRelease, nextLink);
      await replaceCurrentLink(currentLink, nextLink, previousLink);
      await run("systemctl", ["restart", input.apiService, input.webService]);
      try {
        await waitForSmoke(input.smokeUrls, checkHttp, { attempts: smokeAttempts, sleep });
      } catch (rollbackError) {
        throw new Error("New release failed and rollback smoke verification also failed.", {
          cause: new AggregateError([error, rollbackError]),
        });
      }
    }
    throw error;
  }

  return { releaseSha, previousRelease, finalRelease };
}

const parseCli = () => {
  const { values } = parseArgs({
    options: {
      "app-root": { type: "string" },
      "source-dir": { type: "string" },
      "release-sha": { type: "string" },
      "metadata-backup": { type: "string" },
      "api-service": { type: "string" },
      "web-service": { type: "string" },
      "smoke-url": { type: "string", multiple: true },
    },
  });
  return {
    appRoot: values["app-root"],
    sourceDir: values["source-dir"],
    releaseSha: values["release-sha"],
    metadataBackupPath: values["metadata-backup"],
    apiService: values["api-service"],
    webService: values["web-service"],
    smokeUrls: values["smoke-url"] ?? [],
  };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  deployEnergyIqRelease(parseCli())
    .then(({ releaseSha }) => process.stdout.write(`Released ${releaseSha}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

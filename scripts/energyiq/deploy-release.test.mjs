import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { deployEnergyIqRelease } from "./deploy-release.mjs";

const RELEASE_SHA = "1234567890abcdef1234567890abcdef12345678";
const PREVIOUS_SHA = "abcdef1234567890abcdef1234567890abcdef12";

test("stages a real release and switches current only after forced build and smoke gates", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "energyiq-release-"));
  const appRoot = path.join(root, "app");
  const releasesRoot = path.join(appRoot, "releases");
  const previousRelease = path.join(releasesRoot, PREVIOUS_SHA);
  const sourceDir = path.join(root, "source");
  const backupPath = path.join(root, "backups", "metadata-before-release.tar.zst");

  await mkdir(previousRelease, { recursive: true });
  await writeFile(path.join(previousRelease, "previous.txt"), "previous-release", "utf8");
  await symlink(previousRelease, path.join(appRoot, "current"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "package.json"), "{}\n", "utf8");
  await writeFile(path.join(sourceDir, "new.txt"), "new-release", "utf8");
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, "independent-backup", "utf8");

  t.after(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  const commands = [];
  const smokeChecks = [];
  await deployEnergyIqRelease({
    appRoot,
    sourceDir,
    releaseSha: RELEASE_SHA,
    metadataBackupPath: backupPath,
    apiService: "energyiq-api",
    webService: "energyiq-web",
    smokeUrls: [
      "http://127.0.0.1:8787/healthz",
      "http://127.0.0.1:3000/login",
      "http://127.0.0.1:3000/energyiq/overview?projectId=preschool-demo",
    ],
  }, {
    run: async (command, args, options = {}) => {
      commands.push({ command, args, cwd: options.cwd });
      if (command === "git" && args.at(-1) === "HEAD") return { stdout: `${RELEASE_SHA}\n` };
      return { stdout: "" };
    },
    checkHttp: async (url) => {
      smokeChecks.push(url);
    },
  });

  const finalRelease = path.join(releasesRoot, RELEASE_SHA);
  assert.equal((await stat(finalRelease)).isDirectory(), true);
  assert.equal((await stat(finalRelease)).isSymbolicLink(), false);
  assert.equal(await readFile(path.join(finalRelease, "new.txt"), "utf8"), "new-release");
  assert.equal(await readFile(path.join(previousRelease, "previous.txt"), "utf8"), "previous-release");
  assert.equal(await readFile(path.join(finalRelease, ".release-sha"), "utf8"), `${RELEASE_SHA}\n`);
  assert.equal(await readFile(path.join(finalRelease, "RELEASE_SHA"), "utf8"), `${RELEASE_SHA}\n`);
  assert.equal(await realpath(path.join(appRoot, "current")), await realpath(finalRelease));

  assert.deepEqual(
    commands.filter(({ command }) => command === "npm").map(({ args }) => args),
    [
      ["ci"],
      ["run", "build", "--", "--force"],
      ["run", "build:web"],
    ],
  );
  assert.deepEqual(
    commands.filter(({ command }) => command === "systemctl").map(({ args }) => args),
    [["restart", "energyiq-api", "energyiq-web"]],
  );
  assert.deepEqual(smokeChecks, [
    "http://127.0.0.1:8787/healthz",
    "http://127.0.0.1:3000/login",
    "http://127.0.0.1:3000/energyiq/overview?projectId=preschool-demo",
    "http://127.0.0.1:8787/healthz",
    "http://127.0.0.1:3000/login",
    "http://127.0.0.1:3000/energyiq/overview?projectId=preschool-demo",
  ]);
});

test("refuses to switch current when a build changes the release identity markers", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "energyiq-release-identity-"));
  const appRoot = path.join(root, "app");
  const releasesRoot = path.join(appRoot, "releases");
  const previousRelease = path.join(releasesRoot, PREVIOUS_SHA);
  const sourceDir = path.join(root, "source");
  const backupPath = path.join(root, "backups", "metadata-before-release.tar.zst");

  await mkdir(previousRelease, { recursive: true });
  await writeFile(path.join(previousRelease, "previous.txt"), "previous-release", "utf8");
  await symlink(previousRelease, path.join(appRoot, "current"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "package.json"), "{}\n", "utf8");
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, "independent-backup", "utf8");

  t.after(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  await assert.rejects(
    deployEnergyIqRelease({
      appRoot,
      sourceDir,
      releaseSha: RELEASE_SHA,
      metadataBackupPath: backupPath,
      apiService: "energyiq-api",
      webService: "energyiq-web",
      smokeUrls: ["http://api/healthz", "http://web/login", "http://web/overview"],
    }, {
      run: async (command, args, options = {}) => {
        if (command === "git" && args.at(-1) === "HEAD") return { stdout: `${RELEASE_SHA}\n` };
        if (command === "npm" && args[1] === "build:web") {
          await writeFile(path.join(options.cwd, "RELEASE_SHA"), `${PREVIOUS_SHA}\n`, "utf8");
        }
        return { stdout: "" };
      },
      checkHttp: async () => {},
    }),
    /release identity/i,
  );

  assert.equal(await realpath(path.join(appRoot, "current")), await realpath(previousRelease));
  assert.equal(await readFile(path.join(previousRelease, "previous.txt"), "utf8"), "previous-release");
});

test("rejects a metadata backup symlink that resolves inside the application root", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "energyiq-release-backup-"));
  const appRoot = path.join(root, "app");
  const releasesRoot = path.join(appRoot, "releases");
  const previousRelease = path.join(releasesRoot, PREVIOUS_SHA);
  const sourceDir = path.join(root, "source");
  const hiddenBackup = path.join(appRoot, "shared", "metadata-backup");
  const externalBackup = path.join(root, "backups", "metadata-backup");

  await mkdir(previousRelease, { recursive: true });
  await symlink(previousRelease, path.join(appRoot, "current"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "package.json"), "{}\n", "utf8");
  await mkdir(hiddenBackup, { recursive: true });
  await writeFile(path.join(hiddenBackup, "workbench.sqlite"), "not-independent", "utf8");
  await mkdir(path.dirname(externalBackup), { recursive: true });
  await symlink(hiddenBackup, externalBackup, process.platform === "win32" ? "junction" : "dir");

  t.after(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  await assert.rejects(
    deployEnergyIqRelease({
      appRoot,
      sourceDir,
      releaseSha: RELEASE_SHA,
      metadataBackupPath: externalBackup,
      apiService: "energyiq-api",
      webService: "energyiq-web",
      smokeUrls: ["http://api/healthz", "http://web/login", "http://web/overview"],
    }, {
      run: async (command) => command === "git" ? { stdout: `${RELEASE_SHA}\n` } : { stdout: "" },
      checkHttp: async () => {},
    }),
    /backup.*outside/i,
  );

  assert.equal(await realpath(path.join(appRoot, "current")), await realpath(previousRelease));
});

test("rolls back and rechecks the previous release when post-switch smoke fails", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "energyiq-release-rollback-"));
  const appRoot = path.join(root, "app");
  const releasesRoot = path.join(appRoot, "releases");
  const previousRelease = path.join(releasesRoot, PREVIOUS_SHA);
  const sourceDir = path.join(root, "source");
  const backupPath = path.join(root, "backups", "metadata-before-release.tar.zst");
  const smokeUrls = ["http://api/healthz", "http://web/login", "http://web/overview"];

  await mkdir(previousRelease, { recursive: true });
  await writeFile(path.join(previousRelease, "previous.txt"), "previous-release", "utf8");
  await symlink(previousRelease, path.join(appRoot, "current"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "package.json"), "{}\n", "utf8");
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, "independent-backup", "utf8");

  t.after(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  const commands = [];
  const smokeChecks = [];
  await assert.rejects(
    deployEnergyIqRelease({
      appRoot,
      sourceDir,
      releaseSha: RELEASE_SHA,
      metadataBackupPath: backupPath,
      apiService: "energyiq-api",
      webService: "energyiq-web",
      smokeUrls,
    }, {
      run: async (command, args) => {
        commands.push({ command, args });
        return command === "git" && args.at(-1) === "HEAD" ? { stdout: `${RELEASE_SHA}\n` } : { stdout: "" };
      },
      checkHttp: async (url) => {
        smokeChecks.push(url);
        if (smokeChecks.length === 4) throw new Error("post-switch smoke failed");
      },
    }),
    /post-switch smoke failed/,
  );

  assert.equal(await realpath(path.join(appRoot, "current")), await realpath(previousRelease));
  assert.deepEqual(
    commands.filter(({ command }) => command === "systemctl").map(({ args }) => args),
    [
      ["restart", "energyiq-api", "energyiq-web"],
      ["restart", "energyiq-api", "energyiq-web"],
    ],
  );
  assert.deepEqual(smokeChecks, [
    ...smokeUrls,
    smokeUrls[0],
    ...smokeUrls,
  ]);
});

test("rejects a dirty source checkout even when HEAD matches the requested SHA", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "energyiq-release-dirty-"));
  const appRoot = path.join(root, "app");
  const releasesRoot = path.join(appRoot, "releases");
  const previousRelease = path.join(releasesRoot, PREVIOUS_SHA);
  const sourceDir = path.join(root, "source");
  const backupPath = path.join(root, "backups", "metadata-before-release.tar.zst");

  await mkdir(previousRelease, { recursive: true });
  await symlink(previousRelease, path.join(appRoot, "current"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "package.json"), "{}\n", "utf8");
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, "independent-backup", "utf8");

  t.after(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  });

  await assert.rejects(
    deployEnergyIqRelease({
      appRoot,
      sourceDir,
      releaseSha: RELEASE_SHA,
      metadataBackupPath: backupPath,
      apiService: "energyiq-api",
      webService: "energyiq-web",
      smokeUrls: ["http://api/healthz", "http://web/login", "http://web/overview"],
    }, {
      run: async (command, args) => {
        if (command === "git" && args.at(-1) === "HEAD") return { stdout: `${RELEASE_SHA}\n` };
        if (command === "git" && args.at(-1) === "--porcelain") return { stdout: " M apps/api/src/server.ts\n" };
        return { stdout: "" };
      },
      checkHttp: async () => {},
    }),
    /source checkout.*clean/i,
  );

  assert.equal(await realpath(path.join(appRoot, "current")), await realpath(previousRelease));
});

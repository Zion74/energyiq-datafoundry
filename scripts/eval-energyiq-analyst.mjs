import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  compareEnergyIqHarnessReports,
  runEnergyIqHarnessEval,
} from "../apps/api/dist/energy/energyiq-harness-eval.js";

const args = parseArgs(process.argv.slice(2));
const suiteId = args.suite ?? "fast";
const profileId = args.profile ?? process.env.ENERGYIQ_TEST_MODEL_PROFILE_ID ?? "energyiq-deepseek-v4-flash";
const candidateVersion = args.candidate ?? process.env.ENERGYIQ_HARNESS_CANDIDATE_VERSION ?? "working-tree";
let baseUrl = (args["base-url"] ?? process.env.PROTOCOL_E2E_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/u, "");
const attemptsPerCase = positiveInteger(args.repeats ?? process.env.ENERGYIQ_HARNESS_EVAL_REPEATS ?? "1");
const caseIds = args.case?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
const outputDir = resolve(args["output-dir"] ?? "artifacts/energyiq-harness-eval");
const authToken = process.env.ENERGYIQ_EVAL_AUTH_TOKEN ?? "dev-token";

let embeddedServer = null;
if (args.embedded === "true") {
  if (!process.env.STORAGE_ROOT_DIR) throw new Error("--embedded requires an explicit STORAGE_ROOT_DIR fixture");
  process.env.DATAFOUNDRY_AUTH_MODE = "dev";
  const { createServer } = await import("../apps/api/dist/server.js");
  // Trace summaries are asynchronous presentation artifacts, not part of the
  // Analyst answer contract. Disable them so embedded Eval shutdown cannot
  // close SQLite while a background summarizer is still writing.
  embeddedServer = await createServer({ traceSectionSummaries: false });
  await new Promise((resolveListen) => embeddedServer.listen(0, "127.0.0.1", resolveListen));
  const address = embeddedServer.address();
  if (!address || typeof address !== "object") throw new Error("Embedded API did not expose a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

let runError = null;
try {
  await runAndWriteReport();
} catch (error) {
  runError = error;
  process.exitCode = 1;
  console.error(error);
} finally {
  if (embeddedServer) await closeEmbeddedServer(embeddedServer);
}
if (embeddedServer) {
  // Embedded Eval owns the whole process. Provider SDKs may retain idle
  // handles after the report and server are closed, so exit explicitly only
  // after all acceptance artifacts and console output have been flushed.
  await new Promise((resolveFlush) => process.stdout.write("", resolveFlush));
  await new Promise((resolveFlush) => process.stderr.write("", resolveFlush));
  process.exit(process.exitCode ?? 0);
}
if (runError) throw runError;

async function closeEmbeddedServer(server) {
  let closed = false;
  const gracefulClose = new Promise((resolveClose) => {
    server.close(() => {
      closed = true;
      resolveClose();
    });
  });
  server.closeAllConnections?.();
  await Promise.race([
    gracefulClose,
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (!closed) server.closeAllConnections?.();
}

async function runAndWriteReport() {
  const report = await runEnergyIqHarnessEval({
    suiteId,
    profileId,
    candidateVersion,
    baseUrl,
    attemptsPerCase,
    caseIds,
    runCase: async (evalCase, context) => runLiveCase(evalCase, context),
  });

  let comparison = null;
  if (args.baseline) {
    const baseline = JSON.parse(await readFile(resolve(args.baseline), "utf8"));
    comparison = compareEnergyIqHarnessReports(baseline, report);
  }

  await mkdir(outputDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/gu, "-");
  const baseName = `${suiteId}-${profileId}-${stamp}`;
  const jsonPath = resolve(outputDir, `${baseName}.json`);
  const markdownPath = resolve(outputDir, `${baseName}.md`);
  await writeFile(jsonPath, `${JSON.stringify({ ...report, comparison }, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(report, comparison), "utf8");

  console.log(JSON.stringify({
    status: report.status,
    suiteId,
    profileId,
    candidateVersion,
    summary: report.summary,
    comparison,
    jsonPath,
    markdownPath,
  }, null, 2));

  if (report.status !== "passed") process.exitCode = 1;
}

async function runLiveCase(evalCase, { attempt }) {
  const stamp = `${Date.now()}-${attempt}`;
  const runId = `energyiq-harness-eval-${evalCase.id}-${stamp}`;
  const threadId = `energyiq-harness-eval-thread-${evalCase.id}-${stamp}`;
  const startedAt = Date.now();
  const timeoutMs = 5 * 60 * 1000;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`ENERGYIQ_HARNESS_EVAL_TIMEOUT:${timeoutMs}`));
  }, timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/copilotkit`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        "X-Workspace-Id": evalCase.workspaceId,
      },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: "dataFoundry" },
        body: {
          threadId,
          runId,
          state: {},
          messages: [{ id: `${runId}:user`, role: "user", content: evalCase.question }],
          tools: [],
          context: [],
          forwardedProps: {
            externalContext: {
              source: "energyiq",
              projectId: evalCase.projectId,
              scopeId: evalCase.scopeId,
              resource: evalCase.resource,
              period: "Custom",
              from: evalCase.from,
              to: evalCase.to,
            },
            run_config: {
              protocol: { id: "data-analysis", version: "1" },
              activeLlmProfileId: profileId,
              activeSkillId: "data-analysis",
              enabledDatasourceIds: [],
              enabledKnowledgeIds: [],
              enabledMcpServerIds: [],
              enabledSkillIds: ["data-analysis"],
            },
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Agent HTTP failure (${response.status}): ${responseBody.slice(0, 2_000)}`);
    }
    return {
      events: await readEventStreamUntilTerminal(response),
      elapsedMs: Date.now() - startedAt,
      runId,
      threadId,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readEventStreamUntilTerminal(response) {
  if (!response.body) throw new Error("ENERGYIQ_HARNESS_EVAL_STREAM_MISSING");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const parsed = consumeEventStreamChunks(buffer, done);
      buffer = parsed.remainder;
      for (const event of parsed.events) {
        events.push(event);
        if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
          await reader.cancel();
          return events;
        }
      }
      if (done) throw new Error("ENERGYIQ_HARNESS_EVAL_TERMINAL_EVENT_MISSING");
    }
  } finally {
    reader.releaseLock();
  }
}

function consumeEventStreamChunks(buffer, flush) {
  const chunks = buffer.split(/\r?\n\r?\n/gu);
  const remainder = flush ? "" : (chunks.pop() ?? "");
  const completeChunks = flush && chunks.at(-1) === "" ? chunks.slice(0, -1) : chunks;
  return {
    remainder,
    events: completeChunks.flatMap((chunk) => {
      const payload = chunk.split(/\r?\n/gu)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      if (!payload || payload === "[DONE]") return [];
      return [JSON.parse(payload)];
    }),
  };
}

function renderMarkdown(value, delta) {
  const rows = value.cases.map((entry) => {
    const failed = entry.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id).join(", ") || "-";
    return `| ${escapeCell(entry.caseId)} | ${entry.attempt} | ${entry.status} | ${entry.metrics.elapsedMs} | ${entry.metrics.sqlCalls} | ${entry.metrics.reasoningRounds} | ${entry.metrics.failedToolCalls} | ${entry.metrics.recoveredToolFailures} | ${entry.snapshotIds.length} | ${entry.metrics.insightQuality ?? "-"} | ${escapeCell(failed)} |`;
  });
  return [
    `# EnergyIQ Analyst Harness Eval — ${value.candidateVersion}`,
    "",
    `- Suite: \`${value.suiteId}\``,
    `- Profile: \`${value.profileId}\``,
    `- Generated: ${value.generatedAt}`,
    `- Status: **${value.status}**`,
    `- Pass rate: ${(value.summary.passRate * 100).toFixed(1)}%`,
    `- P50 / P95 latency: ${value.summary.p50ElapsedMs} / ${value.summary.p95ElapsedMs} ms`,
    `- Average SQL / reasoning rounds: ${value.summary.averageSqlCalls.toFixed(2)} / ${value.summary.averageReasoningRounds.toFixed(2)}`,
    `- Average insight quality: ${value.summary.averageInsightQuality ?? "n/a"}/10`,
    `- Hard failures: ${value.summary.hardFailures}`,
    `- Failed / recovered tool calls: ${value.summary.totalFailedToolCalls} / ${value.summary.totalRecoveredToolFailures}`,
    ...(delta ? ["", "## Candidate vs baseline", "", "```json", JSON.stringify(delta, null, 2), "```"] : []),
    "",
    "## Cases",
    "",
    "| Case | Attempt | Status | Latency ms | SQL | Reasoning | Failed tools | Recovered | Snapshots | Insight /10 | Failed assertions |",
    "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...rows,
    "",
    "## Answers",
    "",
    ...value.cases.flatMap((entry) => [
      `### ${entry.caseId} — attempt ${entry.attempt}`,
      "",
      entry.answer || "_No answer_",
      "",
    ]),
  ].join("\n");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

function escapeCell(value) {
  return String(value).replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

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
  embeddedServer = await createServer();
  await new Promise((resolveListen) => embeddedServer.listen(0, "127.0.0.1", resolveListen));
  const address = embeddedServer.address();
  if (!address || typeof address !== "object") throw new Error("Embedded API did not expose a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

try {
  await runAndWriteReport();
} finally {
  if (embeddedServer) {
    await new Promise((resolveClose, rejectClose) => {
      embeddedServer.close((error) => error ? rejectClose(error) : resolveClose());
      setImmediate(() => embeddedServer.closeAllConnections?.());
    });
  }
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
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(`Agent HTTP failure (${response.status}): ${responseBody.slice(0, 2_000)}`);
  return {
    events: parseEventStream(responseBody),
    elapsedMs: Date.now() - startedAt,
    runId,
    threadId,
  };
}

function parseEventStream(text) {
  return text
    .split(/\r?\n\r?\n/gu)
    .map((chunk) => chunk.split(/\r?\n/gu)
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("\n"))
    .filter((chunk) => chunk && chunk !== "[DONE]")
    .map((chunk) => JSON.parse(chunk));
}

function renderMarkdown(value, delta) {
  const rows = value.cases.map((entry) => {
    const failed = entry.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id).join(", ") || "-";
    return `| ${escapeCell(entry.caseId)} | ${entry.attempt} | ${entry.status} | ${entry.metrics.elapsedMs} | ${entry.metrics.sqlCalls} | ${entry.metrics.reasoningRounds} | ${entry.metrics.insightQuality ?? "-"} | ${escapeCell(failed)} |`;
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
    ...(delta ? ["", "## Candidate vs baseline", "", "```json", JSON.stringify(delta, null, 2), "```"] : []),
    "",
    "## Cases",
    "",
    "| Case | Attempt | Status | Latency ms | SQL | Reasoning | Insight /10 | Failed assertions |",
    "|---|---:|---|---:|---:|---:|---:|---|",
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

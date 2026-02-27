import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

type MonitorDefinition = {
  name: string;
  url: string;
};

type MonitorResult = {
  name: string;
  url: string;
  status: number | null;
  latencyMs: number | null;
  sslDaysLeft: number | null;
  ok: boolean;
  error: string | null;
  checkedAt: string;
};

type HistoryEntry = {
  timestamp: string;
  timeoutMs: number;
  sslTimeoutMs: number;
  results: MonitorResult[];
};

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MONITORS_PATH = resolve(ROOT_DIR, "monitors.json");
const STATUS_PATH = resolve(ROOT_DIR, "STATUS.md");
const HISTORY_PATH = resolve(ROOT_DIR, "data", "status.json");

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[WARN] ${name}="${raw}" is invalid. Using ${fallback}.`);
    return fallback;
  }
  return Math.floor(parsed);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function assertMonitors(value: unknown): MonitorDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error("monitors.json must be an array.");
  }

  return value.map((item, index) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as { name?: unknown }).name !== "string" ||
      typeof (item as { url?: unknown }).url !== "string"
    ) {
      throw new Error(
        `monitors.json item at index ${index} must be { "name": string, "url": string }.`,
      );
    }

    return {
      name: (item as { name: string }).name,
      url: (item as { url: string }).url,
    };
  });
}

async function getSslDaysLeft(
  targetUrl: string,
  timeoutMs: number,
): Promise<{ daysLeft: number | null; error: string | null }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return { daysLeft: null, error: "Invalid URL for SSL check." };
  }

  if (parsedUrl.protocol !== "https:") {
    return { daysLeft: null, error: null };
  }

  const port = parsedUrl.port ? Number(parsedUrl.port) : 443;
  if (!Number.isFinite(port) || port <= 0) {
    return { daysLeft: null, error: "Invalid HTTPS port for SSL check." };
  }

  return new Promise((resolvePromise) => {
    const socket = tls.connect({
      host: parsedUrl.hostname,
      port,
      servername: parsedUrl.hostname,
      rejectUnauthorized: false,
    });

    let settled = false;
    const timer = setTimeout(() => {
      finish({
        daysLeft: null,
        error: `SSL timeout after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    const finish = (value: { daysLeft: number | null; error: string | null }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolvePromise(value);
    };

    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      if (!cert || typeof cert.valid_to !== "string" || cert.valid_to.length === 0) {
        finish({ daysLeft: null, error: "SSL certificate not available." });
        return;
      }

      const expiresAt = new Date(cert.valid_to);
      if (Number.isNaN(expiresAt.getTime())) {
        finish({ daysLeft: null, error: "SSL certificate expiration is unreadable." });
        return;
      }

      const daysLeft = Math.ceil(
        (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      finish({ daysLeft, error: null });
    });

    socket.once("error", (error) => {
      finish({ daysLeft: null, error: `SSL error: ${formatError(error)}` });
    });
  });
}

async function checkMonitor(
  monitor: MonitorDefinition,
  checkedAt: string,
  timeoutMs: number,
  sslTimeoutMs: number,
): Promise<MonitorResult> {
  const notes: string[] = [];
  let status: number | null = null;
  let latencyMs: number | null = null;
  let sslDaysLeft: number | null = null;
  let requestSucceeded = false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();

    try {
      const response = await fetch(monitor.url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      latencyMs = Math.round(performance.now() - start);
      status = response.status;
      requestSucceeded = true;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      notes.push(`HTTP timeout after ${timeoutMs}ms.`);
    } else {
      notes.push(`HTTP request failed: ${formatError(error)}`);
    }
  }

  if (status !== null && (status < 200 || status >= 400)) {
    notes.push(`HTTP status ${status}.`);
  }

  if (requestSucceeded && monitor.url.startsWith("https://")) {
    const sslResult = await getSslDaysLeft(monitor.url, sslTimeoutMs);
    sslDaysLeft = sslResult.daysLeft;
    if (sslResult.error) {
      notes.push(sslResult.error);
    }
  }

  const ok = status !== null && status >= 200 && status < 400;
  return {
    name: monitor.name,
    url: monitor.url,
    status,
    latencyMs,
    sslDaysLeft,
    ok,
    error: notes.length > 0 ? notes.join(" ") : null,
    checkedAt,
  };
}

function sortResults(a: MonitorResult, b: MonitorResult): number {
  if (a.ok !== b.ok) {
    return a.ok ? 1 : -1;
  }

  const aLatency = a.latencyMs ?? -1;
  const bLatency = b.latencyMs ?? -1;
  return bLatency - aLatency;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function formatSslDays(result: MonitorResult): string {
  if (!result.url.startsWith("https://")) {
    return "n/a";
  }
  if (result.sslDaysLeft === null) {
    return "-";
  }
  return String(result.sslDaysLeft);
}

function buildStatusMarkdown(timestamp: string, results: MonitorResult[]): string {
  const upCount = results.filter((result) => result.ok).length;
  const downCount = results.length - upCount;
  const rows = results.map((result) => {
    const state = result.ok ? "UP" : "DOWN";
    const http = result.status === null ? "-" : String(result.status);
    const latency = result.latencyMs === null ? "-" : `${result.latencyMs} ms`;
    const notes = result.error ?? "";
    return `| ${escapeCell(result.name)} | ${escapeCell(result.url)} | ${state} | ${http} | ${latency} | ${formatSslDays(result)} | ${escapeCell(notes)} |`;
  });

  return [
    "# StatusPulse",
    "",
    `Updated: ${timestamp}`,
    "",
    `Total: ${results.length} | Up: ${upCount} | Down: ${downCount}`,
    "",
    "| Name | URL | State | HTTP | Latency | SSL Days Left | Notes |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const timeoutMs = parseNumberEnv("TIMEOUT_MS", 8000);
  const sslTimeoutMs = parseNumberEnv("SSL_TIMEOUT_MS", 6000);
  const runTimestamp = new Date().toISOString();

  const monitorData = await readJsonFile<unknown>(MONITORS_PATH, []);
  const monitors = assertMonitors(monitorData);
  if (monitors.length === 0) {
    console.warn("[WARN] No monitors found in monitors.json.");
  }

  const checkResults = await Promise.all(
    monitors.map((monitor) =>
      checkMonitor(monitor, runTimestamp, timeoutMs, sslTimeoutMs),
    ),
  );

  const sortedResults = [...checkResults].sort(sortResults);

  for (const result of sortedResults) {
    if (!result.ok || result.error) {
      console.error(
        `[FAIL] ${result.name} (${result.url}) -> ${result.error ?? "Unknown failure."}`,
      );
    }
  }

  const statusContent = buildStatusMarkdown(runTimestamp, sortedResults);
  await mkdir(resolve(ROOT_DIR, "data"), { recursive: true });
  await writeFile(STATUS_PATH, statusContent, "utf8");

  const history = await readJsonFile<HistoryEntry[]>(HISTORY_PATH, []);
  const nextHistory = [...history, {
    timestamp: runTimestamp,
    timeoutMs,
    sslTimeoutMs,
    results: sortedResults,
  }].slice(-365);

  await writeFile(HISTORY_PATH, `${JSON.stringify(nextHistory, null, 2)}\n`, "utf8");
  console.log(`[OK] STATUS.md updated with ${sortedResults.length} monitor(s).`);
}

main().catch((error) => {
  console.error(`[FATAL] ${formatError(error)}`);
  process.exitCode = 1;
});

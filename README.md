# StatusPulse

StatusPulse is a tiny TypeScript + Node project that checks a list of URLs and generates:

- `STATUS.md` (human-readable markdown report)
- `data/status.json` (historical snapshots, last 365 runs)

It is designed for a public repository you can maintain in about 10 minutes per day.

## Requirements

- Node.js 20+
- npm

## Quick Start

```powershell
npm ci
npm run run
```

After running, review `STATUS.md`.

## Configure Monitors

Edit `monitors.json`:

```json
[
  { "name": "Example", "url": "https://example.com" },
  { "name": "API", "url": "https://api.your-domain.com/health" }
]
```

## Environment Variables

- `TIMEOUT_MS` (default `8000`)
- `SSL_TIMEOUT_MS` (default `6000`)

PowerShell example:

```powershell
$env:TIMEOUT_MS = "10000"
$env:SSL_TIMEOUT_MS = "7000"
npm run run
```

## GitHub Actions (Daily Run)

Workflow file: `.github/workflows/daily.yml`

It runs daily, executes `npm ci` + `npm run run`, and commits updated `STATUS.md` + `data/status.json` if they changed.

Set these repository variables in GitHub:

- `STATUSPULSE_GIT_NAME` (example: `StatusPulse Bot`)
- `STATUSPULSE_GIT_EMAIL` (example: `replace-with-your-email@example.com`)

## Contribution Graph Note

If your main goal is GitHub contribution graph activity, manual daily commits from your personal account are usually the most reliable approach. Scheduled bot commits may or may not count depending on author identity and account settings.

## Roadmap (SaaS Upgrade Ideas)

- Slack/Discord/email alerting for downtime
- Retry policy and incident windows
- Regional checks (multi-location latency)
- Basic web UI for uptime history
- Team/project multi-tenant model with auth and billing

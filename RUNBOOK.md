# StatusPulse Runbook (PowerShell)

## 1) First-Time Setup

```powershell
Set-Location C:\Users\hasan\Desktop\statuspulse
npm ci
```

## 2) Add or Update Monitors

Edit `monitors.json` in this format:

```json
[
  { "name": "Service Name", "url": "https://your-url.example" }
]
```

## 3) Run a Check Locally

```powershell
Set-Location C:\Users\hasan\Desktop\statuspulse
npm run run
```

Optional custom timeout:

```powershell
$env:TIMEOUT_MS = "10000"
$env:SSL_TIMEOUT_MS = "7000"
npm run run
```

## 4) Commit Daily Update Manually

```powershell
Set-Location C:\Users\hasan\Desktop\statuspulse
git add STATUS.md data/status.json monitors.json
git commit -m "chore: daily status update"
git push
```

## 5) Enable GitHub Actions Auto-Run

1. Push this repository to GitHub.
2. Confirm `.github/workflows/daily.yml` exists on `main`.
3. In GitHub repo settings, add variables:
   - `STATUSPULSE_GIT_NAME` (example: `StatusPulse Bot`)
   - `STATUSPULSE_GIT_EMAIL` (example: `replace-with-your-email@example.com`)
4. Enable Actions if disabled.
5. Optionally trigger the workflow manually from the Actions tab.

## Daily Routine (10 Minutes)

1. Open `monitors.json` and update endpoints if needed.
2. Run `npm run run`.
3. Review `STATUS.md` for failures/latency spikes.
4. Commit and push `STATUS.md` + `data/status.json`.

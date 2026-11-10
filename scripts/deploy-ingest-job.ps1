<#
.SYNOPSIS
  Creates (or updates) the GCP-native weekly Scryfall ingest: a Cloud Run Job
  plus a Cloud Scheduler trigger.

.DESCRIPTION
  Everything here is idempotent - run it again after changing the ingest and
  it rebuilds the image and rolls the job forward. Nothing it creates has a
  public endpoint: the job is invoked only through the Cloud Run Admin API by
  one service account that holds nothing but run.invoker on this one job.

  Two service accounts, because they want different things:
    mtg-ingest            runs the container; reads one secret
    mtg-ingest-scheduler  starts the job; cannot read the secret

  The regions are not a typo. The job runs in us-east5 (Columbus, Ohio)
  because the Neon database is in AWS us-east-2 (also Ohio) and the ingest is
  round-trip heavy. Cloud Scheduler is not offered in us-east5, so the
  trigger lives in us-east4 and calls across; it sends one API request a
  week, so its own latency is irrelevant.

.EXAMPLE
  powershell -File scripts/deploy-ingest-job.ps1
  powershell -File scripts/deploy-ingest-job.ps1 -SkipBuild
#>
param(
  [string]$ProjectId       = "magictracker-514320",
  [string]$JobRegion       = "us-east5",
  [string]$SchedulerRegion = "us-east4",
  [string]$JobName         = "ingest-cards",
  [string]$RepoName        = "magictracker",
  [string]$SecretName      = "DATABASE_URL_UNPOOLED",
  # Mondays 09:17 UTC. Odd minute on purpose: schedules on the hour queue
  # behind everyone else's.
  [string]$Schedule        = "17 9 * * 1",
  # Only used when the secret does not exist yet. Left empty, the script
  # reads DATABASE_URL_UNPOOLED out of .env.local.
  [string]$DatabaseUrl     = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Note($text) { Write-Host "    $text" -ForegroundColor DarkGray }

# Resolved once, to the executable rather than the name. These helpers must
# never invoke the bare name `gcloud`: PowerShell is case-insensitive, so a
# function called Invoke-GCloud that ran `gcloud` would call itself until it
# died of call-depth overflow. Preferring gcloud.cmd also skips the gcloud.ps1
# wrapper, which sets its own $ErrorActionPreference.
$script:GcloudExe = $null
$cmdForm = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
if ($cmdForm) {
  $script:GcloudExe = $cmdForm.Source
} else {
  $anyForm = Get-Command gcloud -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($anyForm) { $script:GcloudExe = $anyForm.Source }
}
if (-not $script:GcloudExe) {
  throw "gcloud is not on PATH. Install the Google Cloud CLI, then run: gcloud auth login"
}

# gcloud writes progress to stderr, so these helpers never redirect streams;
# they go by exit code alone.
function Invoke-Gc {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GcArgs)
  & $script:GcloudExe @GcArgs
  if ($LASTEXITCODE -ne 0) {
    throw "gcloud $($GcArgs -join ' ') failed (exit $LASTEXITCODE)"
  }
}

# Existence probe: a non-zero exit is the answer, not a failure.
function Test-Gc {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GcArgs)
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $script:GcloudExe @GcArgs *> $null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  return ($code -eq 0)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$image        = "$JobRegion-docker.pkg.dev/$ProjectId/$RepoName/$JobName"
$jobSa        = "mtg-ingest@$ProjectId.iam.gserviceaccount.com"
$schedulerSa  = "mtg-ingest-scheduler@$ProjectId.iam.gserviceaccount.com"
$schedulerJob = "$JobName-weekly"
$tag          = (Get-Date -Format "yyyyMMdd-HHmmss")

Step "Target"
Note "project   $ProjectId"
Note "job       $JobName in $JobRegion"
Note "scheduler $schedulerJob in $SchedulerRegion ($Schedule UTC)"

Step "Enabling APIs"
Invoke-Gc services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com --project $ProjectId

Step "Artifact Registry"
if (Test-Gc artifacts repositories describe $RepoName --location $JobRegion --project $ProjectId) {
  Note "repository already exists"
} else {
  Invoke-Gc artifacts repositories create $RepoName --repository-format docker --location $JobRegion --description "MagicTracker job images" --project $ProjectId
}

# Without a cleanup policy the registry grows by one image per deploy for
# ever, and Artifact Registry is only free up to 0.5 GB.
$policyFile = Join-Path ([System.IO.Path]::GetTempPath()) "mtg-cleanup-policy.json"
$policy = @"
[
  {
    "name": "keep-recent",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 3 }
  },
  {
    "name": "delete-old",
    "action": { "type": "Delete" },
    "condition": { "tagState": "ANY", "olderThan": "30d" }
  }
]
"@
[System.IO.File]::WriteAllText($policyFile, $policy, (New-Object System.Text.UTF8Encoding $false))
Invoke-Gc artifacts repositories set-cleanup-policies $RepoName --location $JobRegion --project $ProjectId --policy $policyFile
Remove-Item $policyFile -Force

Step "Secret: $SecretName"
if (Test-Gc secrets describe $SecretName --project $ProjectId) {
  Note "secret already exists; leaving its value alone"
} else {
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    if (-not (Test-Path ".env.local")) {
      throw "Secret $SecretName does not exist and .env.local was not found. Pass -DatabaseUrl '<unpooled connection string>'."
    }
    $match = Select-String -Path ".env.local" -Pattern "^\s*$SecretName\s*=" | Select-Object -First 1
    if (-not $match) {
      throw "Could not find $SecretName in .env.local. Pass -DatabaseUrl '<unpooled connection string>'."
    }
    $DatabaseUrl = ($match.Line -replace "^\s*$SecretName\s*=", "").Trim()
    $DatabaseUrl = $DatabaseUrl.Trim('"')
    $DatabaseUrl = $DatabaseUrl.Trim("'")
    Note "read the value from .env.local"
  }
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    throw "$SecretName resolved to an empty value."
  }
  if ($DatabaseUrl -like "*-pooler.*") {
    Write-Warning "That connection string contains '-pooler'. COPY and long transactions misbehave through PgBouncer; the ingest wants the DIRECT endpoint."
  }

  Invoke-Gc secrets create $SecretName --replication-policy automatic --project $ProjectId
  # Written through a file with no trailing newline: a newline piped in by
  # echo becomes part of the secret, and then part of the connection string.
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tmp, $DatabaseUrl, (New-Object System.Text.UTF8Encoding $false))
    Invoke-Gc secrets versions add $SecretName --data-file $tmp --project $ProjectId
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

Step "Service accounts"
if (Test-Gc iam service-accounts describe $jobSa --project $ProjectId) {
  Note "mtg-ingest already exists"
} else {
  Invoke-Gc iam service-accounts create mtg-ingest --display-name "MagicTracker card ingest job" --project $ProjectId
}
if (Test-Gc iam service-accounts describe $schedulerSa --project $ProjectId) {
  Note "mtg-ingest-scheduler already exists"
} else {
  Invoke-Gc iam service-accounts create mtg-ingest-scheduler --display-name "MagicTracker ingest scheduler" --project $ProjectId
}

# The job's identity gets exactly one permission, on exactly one secret.
Invoke-Gc secrets add-iam-policy-binding $SecretName --member "serviceAccount:$jobSa" --role roles/secretmanager.secretAccessor --project $ProjectId

if ($SkipBuild) {
  Step "Build skipped (-SkipBuild); deploying :latest"
  $deployImage = "${image}:latest"
} else {
  Step "Building image"
  Note "${image}:$tag"
  Invoke-Gc builds submit --config cloudbuild.ingest.yaml --substitutions "_IMAGE=$image,_TAG=$tag" --project $ProjectId
  $deployImage = "${image}:$tag"
}

Step "Cloud Run Job"
# `jobs deploy` creates or updates, so this is the same command either way.
Invoke-Gc run jobs deploy $JobName --image $deployImage --region $JobRegion --project $ProjectId --service-account $jobSa --set-secrets "$SecretName=${SecretName}:latest" --cpu 1 --memory 1Gi --task-timeout 30m --max-retries 1 --parallelism 1 --tasks 1

Step "Letting the scheduler start the job"
Invoke-Gc run jobs add-iam-policy-binding $JobName --region $JobRegion --project $ProjectId --member "serviceAccount:$schedulerSa" --role roles/run.invoker

Step "Cloud Scheduler"
$uri = "https://run.googleapis.com/v2/projects/$ProjectId/locations/$JobRegion/jobs/${JobName}:run"
if (Test-Gc scheduler jobs describe $schedulerJob --location $SchedulerRegion --project $ProjectId) {
  Note "updating the existing schedule"
  Invoke-Gc scheduler jobs update http $schedulerJob --location $SchedulerRegion --project $ProjectId --schedule $Schedule --time-zone Etc/UTC --uri $uri --http-method POST --oauth-service-account-email $schedulerSa --attempt-deadline 60s
} else {
  Invoke-Gc scheduler jobs create http $schedulerJob --location $SchedulerRegion --project $ProjectId --schedule $Schedule --time-zone Etc/UTC --uri $uri --http-method POST --oauth-service-account-email $schedulerSa --attempt-deadline 60s --description "Weekly Scryfall bulk-data ingest"
}

Step "Done"
Write-Host "Run it now:        gcloud run jobs execute $JobName --region $JobRegion --project $ProjectId --wait" -ForegroundColor Yellow
Write-Host "Force a re-ingest: gcloud run jobs execute $JobName --region $JobRegion --project $ProjectId --args=--force --wait" -ForegroundColor Yellow
Write-Host "Tail logs:         gcloud beta run jobs logs tail $JobName --region $JobRegion --project $ProjectId" -ForegroundColor Yellow

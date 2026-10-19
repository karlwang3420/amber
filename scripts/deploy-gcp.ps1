<#
.SYNOPSIS
    GCP Cloud Run Deployment Script for Windows (Amber)

.DESCRIPTION
    This script deploys the Amber Nuxt frontend to Google Cloud Run.

.PARAMETER ProjectId
    GCP Project ID. If not specified, uses the default project from gcloud config.

.PARAMETER Region
    GCP region for deployment. Default: asia-southeast1

.PARAMETER ServiceName
    Cloud Run service name. Default: amber-web

.PARAMETER EnvFile
    Path to .env file for environment variables. Default: .env

.PARAMETER UseCloudBuild
    Use Cloud Build instead of local Docker build.

.PARAMETER RegisterTelegramWebhook
    After deploying, point the Telegram webhook at the service URL with the
    NUXT_TELEGRAM_WEBHOOK_SECRET from the env file as its secret token.

.PARAMETER DryRun
    Print commands without executing them.

.EXAMPLE
    .\scripts\deploy-gcp.ps1

.EXAMPLE
    .\scripts\deploy-gcp.ps1 -ProjectId "my-project" -Region "us-central1"

.EXAMPLE
    .\scripts\deploy-gcp.ps1 -ServiceName "amber-web-prod" -UseCloudBuild

.EXAMPLE
    .\scripts\deploy-gcp.ps1 -UseCloudBuild -DryRun
#>

param(
    [string]$ProjectId,
    [string]$Region = "us-east4",
    [string]$ServiceName = "amber-web",
    [string]$EnvFile = ".env",
    [switch]$DeployConvex,
    [switch]$UseCloudBuild,
    [switch]$RegisterTelegramWebhook,
    [switch]$DryRun
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Colors and formatting
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Blue }
function Write-Success { Write-Host "[SUCCESS] $args" -ForegroundColor Green }
function Write-Warn { Write-Host "[WARNING] $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "[ERROR] $args" -ForegroundColor Red }

function Invoke-GcloudCommand {
    param(
        [string]$Command,
        [string]$Description
    )
    
    Write-Info $Description
    
    if ($DryRun) {
        Write-Host "[DRY-RUN] $Command" -ForegroundColor Yellow
        return $null
    }
    
    $result = Invoke-Expression $Command
    return $result
}

function Test-Prerequisites {
    Write-Info "Checking prerequisites..."
    
    # Check gcloud
    $gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
    if (-not $gcloud) {
        Write-Err "gcloud CLI is not installed. Please install it from: https://cloud.google.com/sdk/docs/install"
        exit 1
    }
    
    # Check Docker if not using Cloud Build
    if (-not $UseCloudBuild) {
        $docker = Get-Command docker -ErrorAction SilentlyContinue
        if (-not $docker) {
            Write-Err "Docker is not installed. Please install Docker or use -UseCloudBuild flag."
            exit 1
        }
    }

    if ($DeployConvex) {
        $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
        if (-not $pnpm) {
            Write-Err "pnpm is required to deploy Convex. Please install pnpm or omit -DeployConvex."
            exit 1
        }
    }
    
    # Check if authenticated
    $account = gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>$null
    if (-not $account) {
        Write-Err "Not authenticated with gcloud. Run: gcloud auth login"
        exit 1
    }
    
    Write-Success "All prerequisites met."
}

function Set-Configuration {
    Write-Info "Setting up configuration..."
    
    # Get project ID if not provided
    if (-not $ProjectId) {
        $script:ProjectId = gcloud config get-value project 2>$null
        if (-not $script:ProjectId) {
            Write-Err "No project ID specified. Use -ProjectId or run: gcloud config set project <PROJECT_ID>"
            exit 1
        }
    }
    
    # Set image names
    $script:ImageName = "gcr.io/$ProjectId/$ServiceName"
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $script:ImageTag = "${ImageName}:${timestamp}"
    $script:ImageLatest = "${ImageName}:latest"
    
    Write-Info "Configuration:"
    Write-Host "  Project ID:      $ProjectId"
    Write-Host "  Region:          $Region"
    Write-Host "  Service Name:    $ServiceName"
    Write-Host "  Image Tag:       $ImageTag"
    Write-Host "  Env File:        $EnvFile"
    Write-Host "  Deploy Convex:   $DeployConvex"
    Write-Host "  Use Cloud Build: $UseCloudBuild"
    Write-Host "  Set TG webhook:  $RegisterTelegramWebhook"
}

function Set-ProcessEnvFromFile {
    param([string]$FilePath)

    if (-not (Test-Path $FilePath)) {
        return
    }

    foreach ($line in Get-Content $FilePath) {
        if ($line -match "^\s*#" -or $line -match "^\s*$") {
            continue
        }

        if ($line -match "^([^=]+)=(.*)$") {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")

            switch ($key) {
                "CONVEX_DEPLOY_KEY" {
                    if (-not $env:CONVEX_DEPLOY_KEY) {
                        $env:CONVEX_DEPLOY_KEY = $value
                    }
                }
                "CONVEX_DEPLOYMENT" {
                    if (-not $env:CONVEX_DEPLOYMENT) {
                        $env:CONVEX_DEPLOYMENT = $value
                    }
                }
                "NUXT_CONVEX_DEPLOYMENT" {
                    if (-not $env:CONVEX_DEPLOYMENT) {
                        $env:CONVEX_DEPLOYMENT = $value
                    }
                }
            }
        }
    }
}

function Enable-GcpApis {
    Write-Info "Enabling required GCP APIs..."
    
    $apis = @(
        "run.googleapis.com",
        "containerregistry.googleapis.com",
        "cloudbuild.googleapis.com",
        "secretmanager.googleapis.com"
    )
    
    foreach ($api in $apis) {
        Invoke-GcloudCommand -Command "gcloud services enable $api --project=$ProjectId --quiet" -Description "Enabling $api..."
    }
    
    Write-Success "APIs enabled."
}

function Get-EnvVarsFile {
    Write-Info "Loading environment variables from $EnvFile..."
    
    if (-not (Test-Path $EnvFile)) {
        Write-Warn "Environment file $EnvFile not found. Secrets will not be configured."
        return ""
    }
    
    # Create a temporary YAML file for env vars (avoids all escaping issues)
    $tempEnvFile = Join-Path $env:TEMP "gcp-deploy-env-$([guid]::NewGuid().ToString('N').Substring(0,8)).yaml"
    $yamlLines = @()
    $definedKeys = @()
    $content = Get-Content $EnvFile

    foreach ($line in $content) {
        # Skip comments and empty lines
        if ($line -match "^\s*#" -or $line -match "^\s*$") {
            continue
        }
        
        # Parse key=value
        if ($line -match "^([^=]+)=(.*)$") {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            
            # Skip local-only and reserved Cloud Run variables
            if ($key -eq "DEBUG" -or $key -eq "HOST" -or $key -eq "PORT") {
                continue
            }
            
            # YAML format: key: "value" (quotes handle special characters)
            # Escape any double quotes in the value
            $value = $value -replace '"', '\"'
            $yamlLines += "${key}: `"${value}`""
            if ($value) {
                $definedKeys += $key
            }
        }
    }

    # Without these the deployed app refuses sign-in and Telegram updates.
    $accessKeys = @(
        "NUXT_CONVEX_SERVER_SECRET",
        "NUXT_SESSION_PASSWORD",
        "NUXT_AUTH_PASSWORD",
        "NUXT_AUTH_JWT_PRIVATE_KEY",
        "NUXT_TELEGRAM_WEBHOOK_SECRET"
    )
    $missingKeys = @($accessKeys | Where-Object { $definedKeys -notcontains $_ })
    if ($missingKeys.Count -gt 0) {
        Write-Err "Missing access secrets in ${EnvFile}: $($missingKeys -join ', ')"
        Write-Err "Run: node scripts/setup-auth.mjs --env $EnvFile"
        exit 1
    }

    # Write YAML file
    $yamlLines | Out-File -FilePath $tempEnvFile -Encoding UTF8
    Write-Success "Environment variables loaded ($($yamlLines.Count) variables)."
    return $tempEnvFile
}

function Deploy-ConvexFunctions {
    Write-Info "Deploying Convex functions..."

    Set-ProcessEnvFromFile -FilePath $EnvFile

    if (-not $env:CONVEX_DEPLOYMENT) {
        Write-Warn "CONVEX_DEPLOYMENT is not set. Convex deploy may fail unless your local CLI is already linked."
    }

    if (-not $env:CONVEX_DEPLOY_KEY) {
        Write-Warn "CONVEX_DEPLOY_KEY is not set. Convex deploy may prompt for authentication or fail in non-interactive runs."
    }

    if ($DryRun) {
        Write-Host "[DRY-RUN] pnpm exec convex deploy" -ForegroundColor Yellow
        return
    }

    & pnpm exec convex deploy
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Convex deploy failed."
        exit 1
    }

    Write-Success "Convex functions deployed."
}

function Build-LocalDocker {
    Write-Info "Building Docker image locally..."
    
    if ($DryRun) {
        Write-Host "[DRY-RUN] docker build -t $ImageTag -t $ImageLatest ." -ForegroundColor Yellow
    }
    else {
        docker build -t $ImageTag -t $ImageLatest .
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Docker build failed."
            exit 1
        }
    }
    
    Write-Success "Docker image built: $ImageTag"
}

function Push-ToGcr {
    Write-Info "Configuring Docker for GCR..."
    Invoke-GcloudCommand -Command "gcloud auth configure-docker gcr.io --quiet" -Description "Configuring Docker..."
    
    Write-Info "Pushing image to Google Container Registry..."
    
    if ($DryRun) {
        Write-Host "[DRY-RUN] docker push $ImageTag" -ForegroundColor Yellow
        Write-Host "[DRY-RUN] docker push $ImageLatest" -ForegroundColor Yellow
    }
    else {
        docker push $ImageTag
        docker push $ImageLatest
        
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Docker push failed."
            exit 1
        }
    }
    
    Write-Success "Image pushed to GCR."
}

function Build-WithCloudBuild {
    Write-Info "Building image using Cloud Build..."
    
    Invoke-GcloudCommand -Command "gcloud builds submit --tag $ImageTag --project=$ProjectId --timeout=20m" -Description "Submitting build..."
    Invoke-GcloudCommand -Command "gcloud container images add-tag $ImageTag $ImageLatest --quiet" -Description "Tagging as latest..."
    
    Write-Success "Image built and pushed via Cloud Build."
}

function Deploy-ToCloudRun {
    param([string]$EnvVarsFile)
    
    Write-Info "Deploying Amber to Cloud Run..."
    
    $deployCmd = @(
        "gcloud run deploy $ServiceName",
        "--image=$ImageTag",
        "--region=$Region",
        "--project=$ProjectId",
        "--platform=managed",
        # Public ingress is required for the Telegram webhook. The app itself
        # requires sign-in, and Convex requires a token or the server secret.
        "--allow-unauthenticated",
        "--port=3000",
        "--memory=512Mi",
        "--cpu=1",
        "--min-instances=0",
        "--max-instances=10",
        "--timeout=300s",
        "--concurrency=80"
    )
    
    if ($EnvVarsFile -and (Test-Path $EnvVarsFile)) {
        $deployCmd += "--env-vars-file=`"$EnvVarsFile`""
    }
    
    $fullCmd = $deployCmd -join " "
    
    if ($DryRun) {
        Write-Host "[DRY-RUN] $fullCmd" -ForegroundColor Yellow
    }
    else {
        Invoke-Expression $fullCmd
        $deployExitCode = $LASTEXITCODE
        
        # Cleanup temp env file
        if ($EnvVarsFile -and (Test-Path $EnvVarsFile)) {
            Remove-Item $EnvVarsFile -Force -ErrorAction SilentlyContinue
        }
        
        if ($deployExitCode -ne 0) {
            Write-Err "Deployment failed."
            exit 1
        }
    }
    
    Write-Success "Deployment complete!"
}

function Get-ServiceUrl {
    Write-Info "Fetching service URL..."
    
    if (-not $DryRun) {
        $serviceUrl = gcloud run services describe $ServiceName --region=$Region --project=$ProjectId --format="value(status.url)"
        
        Write-Host ""
        Write-Success "Deployment successful!"
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
        Write-Host "Service URL: " -NoNewline -ForegroundColor Green
        Write-Host $serviceUrl -ForegroundColor Cyan
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
        Write-Host ""
        Write-Host "To view logs:  gcloud run logs read $ServiceName --region=$Region"
        Write-Host "To update:     .\scripts\deploy-gcp.ps1"
        Write-Host ""
        return $serviceUrl
    }
}

function Get-EnvFileValue {
    param([string]$FilePath, [string]$Key)

    if (-not (Test-Path $FilePath)) {
        return $null
    }

    foreach ($line in Get-Content $FilePath) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=(.*)$") {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

function Register-TelegramWebhook {
    param([string]$ServiceUrl)

    Write-Info "Registering the Telegram webhook with its secret token..."

    if ($DryRun) {
        Write-Host "[DRY-RUN] Telegram setWebhook -> <service URL>/api/telegram/webhook (secret token from $EnvFile)" -ForegroundColor Yellow
        return
    }

    $botToken = Get-EnvFileValue -FilePath $EnvFile -Key "NUXT_TELEGRAM_BOT_TOKEN"
    $secretToken = Get-EnvFileValue -FilePath $EnvFile -Key "NUXT_TELEGRAM_WEBHOOK_SECRET"
    if (-not $botToken -or -not $secretToken -or -not $ServiceUrl) {
        Write-Err "Registering the webhook needs NUXT_TELEGRAM_BOT_TOKEN, NUXT_TELEGRAM_WEBHOOK_SECRET and the service URL."
        exit 1
    }

    $webhookUrl = "$ServiceUrl/api/telegram/webhook"
    $body = @{ url = $webhookUrl; secret_token = $secretToken } | ConvertTo-Json -Compress
    try {
        $response = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$botToken/setWebhook" -ContentType "application/json" -Body $body
    }
    catch {
        # Report only Telegram's reply; the request URL contains the bot token.
        Write-Err "Telegram setWebhook failed: $($_.ErrorDetails.Message)"
        exit 1
    }

    if (-not $response.ok) {
        Write-Err "Telegram rejected the webhook: $($response.description)"
        exit 1
    }
    Write-Success "Telegram webhook set to $webhookUrl"
}

# Main execution
function Main {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host "   Amber Frontend - GCP Deployment Script     " -ForegroundColor Cyan
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host ""
    
    Test-Prerequisites
    Set-Configuration
    Enable-GcpApis
    
    $envVarsFile = Get-EnvVarsFile

    if ($DeployConvex) {
        Deploy-ConvexFunctions
    }
    
    if ($UseCloudBuild) {
        Build-WithCloudBuild
    }
    else {
        Build-LocalDocker
        Push-ToGcr
    }
    
    Deploy-ToCloudRun -EnvVarsFile $envVarsFile
    $serviceUrl = Get-ServiceUrl

    if ($RegisterTelegramWebhook) {
        Register-TelegramWebhook -ServiceUrl $serviceUrl
    }
}

# Run
Main


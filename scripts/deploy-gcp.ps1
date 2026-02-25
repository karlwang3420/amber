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
    [string]$Region = "asia-southeast1",
    [string]$ServiceName = "amber-web",
    [string]$EnvFile = ".env",
    [switch]$UseCloudBuild,
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
    Write-Host "  Use Cloud Build: $UseCloudBuild"
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
        }
    }
    
    # Write YAML file
    $yamlLines | Out-File -FilePath $tempEnvFile -Encoding UTF8
    Write-Success "Environment variables loaded ($($yamlLines.Count) variables)."
    return $tempEnvFile
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
    }
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
    
    if ($UseCloudBuild) {
        Build-WithCloudBuild
    }
    else {
        Build-LocalDocker
        Push-ToGcr
    }
    
    Deploy-ToCloudRun -EnvVarsFile $envVarsFile
    Get-ServiceUrl
}

# Run
Main


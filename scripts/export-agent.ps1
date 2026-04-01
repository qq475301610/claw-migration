# OpenClaw Agent Migration - Export Script
# Exports specified Agent configuration, sessions, and workspace to migration package
# Usage: .\export-agent.ps1 -AgentId "main" -OutputPath "./migration.zip"

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AgentId,
    
    [string]$OutputPath,
    
    [switch]$IncludeTranscripts,
    
    [switch]$SkipValidation,
    
    [string]$OpenClawDir = "$env:USERPROFILE\.openclaw"
)

$ErrorActionPreference = "Stop"
$VerbosePreference = "Continue"

# Exclude patterns (excluding runtime state, not credentials)
$EXCLUDE_PATTERNS = @('*.sqlite', '*.log', '*.deleted.*', '*.reset.*', '*.bak*', '*.tmp', 'auth.json', 'identity', 'data', 'delivery-queue', 'logs', 'subagents', 'browser', 'canvas', 'completions', 'credentials', 'devices', 'qqbot', 'cron')

function Write-Step { param([string]$Message); Write-Host "`n$('-'*64)" -ForegroundColor Cyan; Write-Host "  $Message" -ForegroundColor Cyan; Write-Host "$('-'*64)`n" -ForegroundColor Cyan }
function Write-Success { param([string]$Message); Write-Host "  [OK] $Message" -ForegroundColor Green }
function Write-Error-Custom { param([string]$Message); Write-Host "  [ERROR] $Message" -ForegroundColor Red }
function Write-Warning-Custom { param([string]$Message); Write-Host "  [WARN] $Message" -ForegroundColor Yellow }

try {
    Write-Step "OpenClaw Agent Migration - Export"
    Write-Host "  Agent ID: $AgentId"
    Write-Host "  OpenClaw Dir: $OpenClawDir"
    
    # Step 1: Validate Agent Exists
    Write-Step "Step 1: Validate Agent Exists"
    
    $configPath = "$OpenClawDir\openclaw.json"
    if (-not (Test-Path $configPath)) { throw "Config not found: $configPath" }
    
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    $agent = $config.agents.list | Where-Object { $_.id -eq $AgentId }
    
    if (-not $agent) { throw "Agent not found: $AgentId" }
    Write-Success "Agent '$AgentId' exists"
    
    $workspacePath = if ($agent.workspace) { $agent.workspace } elseif ($config.agents.defaults.workspace) { $config.agents.defaults.workspace } else { "$OpenClawDir\workspace" }
    Write-Host "  Workspace: $workspacePath"
    
    $agentDir = "$OpenClawDir\agents\$AgentId"
    if (-not (Test-Path $agentDir)) { throw "Agent dir not found: $agentDir" }
    Write-Success "Agent Dir: $agentDir"
    
    # Step 2: Create Temp Directory
    Write-Step "Step 2: Create Temp Directory"
    
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $tempDir = "$env:TEMP\openclaw-migration-$AgentId-$timestamp"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    Write-Success "Temp Dir: $tempDir"
    
    # Step 3: Extract Config (Full - No Sanitization)
    Write-Step "Step 3: Extract Config (Full Config)"
    
    $config | ConvertTo-Json -Depth 50 | Out-File "$tempDir\openclaw.json" -Encoding utf8
    Write-Success "Extracted openclaw.json (with credentials)"
    
    $agentConfigDir = "$tempDir\agents\$AgentId\agent"
    New-Item -ItemType Directory -Path $agentConfigDir -Force | Out-Null
    
    $authProfilesPath = "$agentDir\agent\auth-profiles.json"
    if (Test-Path $authProfilesPath) {
        Copy-Item $authProfilesPath "$agentConfigDir\auth-profiles.json" -Force
        Write-Success "Extracted auth-profiles.json (with credentials)"
    }
    
    $modelsPath = "$agentDir\agent\models.json"
    if (Test-Path $modelsPath) {
        Copy-Item $modelsPath "$agentConfigDir\models.json" -Force
        Write-Success "Extracted models.json"
    }
    
    # Step 4: Extract Session Data
    Write-Step "Step 4: Extract Session Data"
    
    $sessionsDir = "$tempDir\agents\$AgentId\sessions"
    New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null
    
    $sessionsJsonPath = "$agentDir\sessions\sessions.json"
    if (Test-Path $sessionsJsonPath) {
        Copy-Item $sessionsJsonPath "$sessionsDir\sessions.json" -Force
        Write-Success "Extracted sessions.json"
    }
    
    if ($IncludeTranscripts) {
        Write-Host "  Including transcripts..."
        $transcripts = Get-ChildItem "$agentDir\sessions" -Filter "*.jsonl" -File
        foreach ($t in $transcripts) {
            if ($t.Name -notlike "*.deleted.*" -and $t.Name -notlike "*.reset.*") {
                Copy-Item $t.FullName "$sessionsDir\$t.Name" -Force
            }
        }
        Write-Success "Extracted transcripts ($($transcripts.Count) files)"
    }
    else { Write-Warning-Custom "Skipping transcripts" }
    
    # Step 5: Extract Workspace
    Write-Step "Step 5: Extract Workspace Files"
    
    if (Test-Path $workspacePath) {
        $workspaceDest = "$tempDir\workspace"
        $files = Get-ChildItem $workspacePath -Recurse -File
        $count = 0
        
        foreach ($file in $files) {
            $relPath = $file.FullName.Replace($workspacePath, '').TrimStart('\')
            $exclude = $false
            foreach ($p in $EXCLUDE_PATTERNS) {
                if ($file.Name -like $p -or $relPath -like "*\$p\*") { $exclude = $true; break }
            }
            if (-not $exclude) {
                $destDir = Split-Path "$workspaceDest\$relPath" -Parent
                if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
                Copy-Item $file.FullName "$workspaceDest\$relPath" -Force
                $count++
            }
        }
        Write-Success "Extracted workspace ($count files)"
    }
    else { Write-Warning-Custom "Workspace not found: $workspacePath" }
    
    # Step 6: Generate Manifest
    Write-Step "Step 6: Generate Manifest"
    
    $manifest = [PSCustomObject]@{
        schema = "openclaw-migration/v1"
        createdAt = (Get-Date -Format 'o')
        openclawVersion = $config.meta.lastTouchedVersion
        source = [PSCustomObject]@{ host = $env:COMPUTERNAME; agentId = $AgentId; workspace = $workspacePath }
        contents = [PSCustomObject]@{ config = $true; sessions = $true; transcripts = $IncludeTranscripts.IsPresent; workspace = $true; memory = $true }
        requires = @{ channels = @(); plugins = @(); skills = @() }
        notes = "Agent '$AgentId' migration package"
    }
    
    if ($config.bindings) { $manifest.requires.channels = ($config.bindings | Where-Object { $_.agentId -eq $AgentId }).match.channel | Select-Object -Unique }
    if ($config.plugins.entries) { $manifest.requires.plugins = ($config.plugins.entries.PSObject.Properties | Where-Object { $_.Value.enabled -ne $false }).Name }
    if ($config.skills.entries) { $manifest.requires.skills = ($config.skills.entries.PSObject.Properties | Where-Object { $_.Value.enabled -ne $false }).Name }
    
    $manifest | ConvertTo-Json -Depth 10 | Out-File "$tempDir\manifest.json" -Encoding utf8
    Write-Success "Generated manifest.json"
    
    # Step 7: Create ZIP
    Write-Step "Step 7: Create ZIP Package"
    
    if (-not $OutputPath) { $OutputPath = "$env:USERPROFILE\openclaw-migration-$AgentId-$timestamp.zip" }
    if (-not [System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath = Join-Path (Get-Location) $OutputPath }
    if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }
    
    # Ensure D:\Backups exists
    $outputDir = Split-Path $OutputPath -Parent
    if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
    
    Compress-Archive -Path "$tempDir\*" -DestinationPath $OutputPath -Force
    $zipSize = [math]::Round((Get-Item $OutputPath).Length / 1MB, 2)
    Write-Success "Created: $OutputPath ($zipSize MB)"
    
    # Step 8: Cleanup
    Write-Step "Step 8: Cleanup"
    Remove-Item $tempDir -Recurse -Force
    Write-Success "Cleaned up"
    
    # Complete
    Write-Step "Export Complete!"
    Write-Success "Package: $OutputPath"
    Write-Host "`nNext: Copy to target and run import script" -ForegroundColor Cyan
}
catch {
    Write-Error-Custom $_.Exception.Message
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    exit 1
}

# OpenClaw Agent Migration - Import Script
# Imports migration package, restores Agent configuration, sessions, and workspace
# Usage: .\import-agent.ps1 -InputPath "./migration.zip" -AgentId "main"

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    
    [Parameter(Mandatory = $true)]
    [string]$AgentId,
    
    [switch]$Force,
    
    [switch]$SkipValidation,
    
    [switch]$NoRestart,
    
    [string]$OpenClawDir = "$env:USERPROFILE\.openclaw"
)

$ErrorActionPreference = "Stop"
$VerbosePreference = "Continue"

$CREDENTIAL_PATTERNS = @('apiKey', 'token', 'secret', 'password', 'clientSecret', 'accessToken', 'refreshToken')

function Write-Step { param([string]$Message); Write-Host "`n$('-'*64)" -ForegroundColor Cyan; Write-Host "  $Message" -ForegroundColor Cyan; Write-Host "$('-'*64)`n" -ForegroundColor Cyan }
function Write-Success { param([string]$Message); Write-Host "  [OK] $Message" -ForegroundColor Green }
function Write-Error-Custom { param([string]$Message); Write-Host "  [ERROR] $Message" -ForegroundColor Red }
function Write-Warning-Custom { param([string]$Message); Write-Host "  [WARN] $Message" -ForegroundColor Yellow }
function Write-Info { param([string]$Message); Write-Host "  [INFO] $Message" -ForegroundColor DarkGray }

function Is-CredentialKey {
    param([string]$Key)
    foreach ($p in $CREDENTIAL_PATTERNS) { if ($Key -like "*$p") { return $true } }
    return $false
}

function Merge-Config {
    param([object]$Source, [object]$Target, [string]$AgentId)
    Write-Info "Merging configurations..."
    
    # Deep copy using JSON serialization (compatible with older PowerShell)
    $json = $Target | ConvertTo-Json -Depth 50
    $result = $json | ConvertFrom-Json
    
    # Preserve target credentials (handle missing structures gracefully)
    Write-Info "  - Preserving credentials"
    
    # Preserve models.providers.*.apiKey
    if ($Target.models -and $Target.models.providers) {
        if (-not $result.models) { $result | Add-Member -NotePropertyName 'models' -NotePropertyValue ([PSCustomObject]@{}) -Force }
        if (-not $result.models.providers) { $result.models | Add-Member -NotePropertyName 'providers' -NotePropertyValue ([PSCustomObject]@{}) -Force }
        
        foreach ($provider in $Target.models.providers.PSObject.Properties.Name) {
            if ($Target.models.providers.$provider.apiKey -and $Target.models.providers.$provider.apiKey -ne "__REDACTED__") {
                if ($result.models.providers.$provider) {
                    $result.models.providers.$provider.apiKey = $Target.models.providers.$provider.apiKey
                }
            }
        }
    }
    
    # Preserve channels tokens and credentials
    if ($Target.channels) {
        if (-not $result.channels) { $result | Add-Member -NotePropertyName 'channels' -NotePropertyValue ([PSCustomObject]@{}) -Force }
        
        foreach ($channel in $Target.channels.PSObject.Properties.Name) {
            # Ensure channel exists in result
            if (-not $result.channels.$channel) {
                $result.channels | Add-Member -NotePropertyName $channel -NotePropertyValue ([PSCustomObject]@{}) -Force
            }
            
            # Preserve token
            if ($Target.channels.$channel.token -and $Target.channels.$channel.token -ne "__REDACTED__") {
                $result.channels.$channel.token = $Target.channels.$channel.token
            }
            
            # Preserve accounts credentials
            if ($Target.channels.$channel.accounts) {
                if (-not $result.channels.$channel.accounts) {
                    $result.channels.$channel | Add-Member -NotePropertyName 'accounts' -NotePropertyValue ([PSCustomObject]@{}) -Force
                }
                
                foreach ($account in $Target.channels.$channel.accounts.PSObject.Properties.Name) {
                    if (-not $result.channels.$channel.accounts.$account) {
                        $result.channels.$channel.accounts | Add-Member -NotePropertyName $account -NotePropertyValue ([PSCustomObject]@{}) -Force
                    }
                    
                    if ($Target.channels.$channel.accounts.$account.clientSecret -and $Target.channels.$channel.accounts.$account.clientSecret -ne "__REDACTED__") {
                        $result.channels.$channel.accounts.$account.clientSecret = $Target.channels.$channel.accounts.$account.clientSecret
                    }
                    if ($Target.channels.$channel.accounts.$account.appId -and $Target.channels.$channel.accounts.$account.appId -ne "__REDACTED__") {
                        $result.channels.$channel.accounts.$account.appId = $Target.channels.$channel.accounts.$account.appId
                    }
                }
            }
        }
    }
    
    # Preserve gateway.auth credentials
    if ($Target.gateway -and $Target.gateway.auth) {
        if (-not $result.gateway) { $result | Add-Member -NotePropertyName 'gateway' -NotePropertyValue ([PSCustomObject]@{}) -Force }
        if (-not $result.gateway.auth) { $result.gateway | Add-Member -NotePropertyName 'auth' -NotePropertyValue ([PSCustomObject]@{}) -Force }
        
        if ($Target.gateway.auth.token -and $Target.gateway.auth.token -ne "__REDACTED__") {
            $result.gateway.auth.token = $Target.gateway.auth.token
        }
        if ($Target.gateway.auth.password -and $Target.gateway.auth.password -ne "__REDACTED__") {
            $result.gateway.auth.password = $Target.gateway.auth.password
        }
    }
    
    # Merge agent config
    Write-Info "  - Merging agent config"
    
    # Ensure source has agents structure
    if (-not $Source.agents) {
        $Source | Add-Member -NotePropertyName 'agents' -NotePropertyValue ([PSCustomObject]@{ list = @() })
    }
    if (-not $Source.agents.list) { $Source.agents.list = @() }
    
    # Ensure target has agents structure
    if (-not $result.agents) {
        $result | Add-Member -NotePropertyName 'agents' -NotePropertyValue ([PSCustomObject]@{ list = @() })
    }
    if (-not $result.agents.list) {
        $result.agents | Add-Member -NotePropertyName 'list' -NotePropertyValue (@())
    }
    if ($result.agents.list -is [System.Collections.IList] -eq $false) {
        $result.agents.list = @($result.agents.list)
    }
    
    $sourceAgent = $Source.agents.list | Where-Object { $_.id -eq $AgentId }
    
    # Fix subagents.allowAgents if it's an object instead of array
    if ($sourceAgent.subagents -and $sourceAgent.subagents.allowAgents) {
        if ($sourceAgent.subagents.allowAgents -isnot [System.Collections.IList]) {
            # Convert object to array
            if ($sourceAgent.subagents.allowAgents -eq "*") {
                $sourceAgent.subagents.allowAgents = @("*")
            }
            else {
                $sourceAgent.subagents.allowAgents = @($sourceAgent.subagents.allowAgents)
            }
        }
    }
    
    $targetAgentIndex = -1
    for ($i = 0; $i -lt $result.agents.list.Count; $i++) {
        if ($result.agents.list[$i].id -eq $AgentId) { $targetAgentIndex = $i; break }
    }
    
    if ($targetAgentIndex -ge 0) {
        Write-Info "    Found existing agent, overwriting"
        $existingWorkspace = $result.agents.list[$targetAgentIndex].workspace
        $result.agents.list[$targetAgentIndex] = $sourceAgent
        if ($existingWorkspace) { $result.agents.list[$targetAgentIndex].workspace = $existingWorkspace }
    }
    else {
        Write-Info "    No existing agent, adding new"
        $result.agents.list += $sourceAgent
    }
    
    # Merge bindings (handle missing bindings gracefully)
    Write-Info "  - Merging bindings"
    
    # Ensure source and target have bindings
    $sourceBindings = @()
    if ($Source.bindings) { $sourceBindings = $Source.bindings | Where-Object { $_.agentId -eq $AgentId } }
    
    $targetBindings = @()
    if ($result.bindings) { $targetBindings = $result.bindings | Where-Object { $_.agentId -ne $AgentId } }
    
    # Create bindings array
    $mergedBindings = @()
    if ($targetBindings) { $mergedBindings += $targetBindings }
    if ($sourceBindings) { $mergedBindings += $sourceBindings }
    
    # Only set bindings if we have any or source had bindings
    if ($mergedBindings.Count -gt 0 -or $Source.bindings) {
        $result | Add-Member -NotePropertyName 'bindings' -NotePropertyValue $mergedBindings -Force
    }
    
    # Preserve session.maintenance (handle missing session gracefully)
    if ($Target.session -and $Target.session.maintenance) {
        if (-not $result.session) {
            $result | Add-Member -NotePropertyName 'session' -NotePropertyValue ([PSCustomObject]@{}) -Force
        }
        $result.session.maintenance = $Target.session.maintenance
    }
    
    # Preserve models.providers credentials (handle missing models gracefully)
    if ($Target.models -and $Target.models.providers) {
        if (-not $result.models) {
            $result | Add-Member -NotePropertyName 'models' -NotePropertyValue ([PSCustomObject]@{}) -Force
        }
        if (-not $result.models.providers) {
            $result.models | Add-Member -NotePropertyName 'providers' -NotePropertyValue ([PSCustomObject]@{}) -Force
        }
        foreach ($providerName in $Target.models.providers.PSObject.Properties.Name) {
            $targetProvider = $Target.models.providers.$providerName
            if ($targetProvider.apiKey) {
                if (-not $result.models.providers.$providerName) {
                    $result.models.providers | Add-Member -NotePropertyName $providerName -NotePropertyValue ([PSCustomObject]@{}) -Force
                }
                $result.models.providers.$providerName.apiKey = $targetProvider.apiKey
            }
        }
    }
    
    # Preserve channels credentials (handle missing channels gracefully)
    if ($Target.channels) {
        if (-not $result.channels) {
            $result | Add-Member -NotePropertyName 'channels' -NotePropertyValue ([PSCustomObject]@{}) -Force
        }
        foreach ($channelName in $Target.channels.PSObject.Properties.Name) {
            $targetChannel = $Target.channels.$channelName
            if ($targetChannel.token) {
                if (-not $result.channels.$channelName) {
                    $result.channels | Add-Member -NotePropertyName $channelName -NotePropertyValue ([PSCustomObject]@{}) -Force
                }
                $result.channels.$channelName.token = $targetChannel.token
            }
            # Preserve account credentials
            if ($targetChannel.accounts) {
                if (-not $result.channels.$channelName.accounts) {
                    $result.channels.$channelName | Add-Member -NotePropertyName 'accounts' -NotePropertyValue ([PSCustomObject]@{}) -Force
                }
                foreach ($accountName in $targetChannel.accounts.PSObject.Properties.Name) {
                    $targetAccount = $targetChannel.accounts.$accountName
                    if ($targetAccount.clientSecret) {
                        if (-not $result.channels.$channelName.accounts.$accountName) {
                            $result.channels.$channelName.accounts | Add-Member -NotePropertyName $accountName -NotePropertyValue ([PSCustomObject]@{}) -Force
                        }
                        $result.channels.$channelName.accounts.$accountName.clientSecret = $targetAccount.clientSecret
                    }
                }
            }
        }
    }
    
    return $result
}

try {
    Write-Step "OpenClaw Agent Migration - Import"
    Write-Host "  Agent ID: $AgentId"
    Write-Host "  Package: $InputPath"
    Write-Host "  OpenClaw Dir: $OpenClawDir"
    
    # Step 1: Validate Input
    Write-Step "Step 1: Validate Input"
    if (-not (Test-Path $InputPath)) { throw "Package not found: $InputPath" }
    Write-Success "Package exists"
    
    # Step 2: Extract
    Write-Step "Step 2: Extract Package"
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $tempDir = "$env:TEMP\openclaw-migration-import-$timestamp"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    Expand-Archive -Path $InputPath -DestinationPath $tempDir -Force
    Write-Success "Extracted: $tempDir"
    
    # Step 3: Validate Manifest
    Write-Step "Step 3: Validate Manifest"
    if (-not (Test-Path "$tempDir\manifest.json")) { throw "Missing manifest.json" }
    $manifest = Get-Content "$tempDir\manifest.json" -Raw | ConvertFrom-Json
    Write-Host "  Created: $($manifest.createdAt)"
    Write-Host "  Version: $($manifest.openclawVersion)"
    Write-Host "  Source Agent: $($manifest.source.agentId)"
    
    if ($manifest.source.agentId -ne $AgentId) {
        Write-Warning-Custom "Agent ID mismatch: $($manifest.source.agentId) vs $AgentId"
        if (-not $Force) {
            $confirm = Read-Host "  Continue? (y/N)"
            if ($confirm -ne 'y') { Write-Info "Cancelled"; exit 0 }
        }
    }
    Write-Success "Manifest validated"
    
    # Step 4: Check Target Config
    Write-Step "Step 4: Check Target Config"
    $configPath = "$OpenClawDir\openclaw.json"
    $targetConfig = $null
    
    if (Test-Path $configPath) {
        $targetConfig = Get-Content $configPath -Raw | ConvertFrom-Json
        Write-Success "Found existing config"
        $existingAgent = $targetConfig.agents.list | Where-Object { $_.id -eq $AgentId }
        if ($existingAgent) {
            Write-Warning-Custom "Existing agent: $AgentId"
            if (-not $Force) {
                $confirm = Read-Host "  Overwrite? (y/N)"
                if ($confirm -ne 'y') { Write-Info "Cancelled"; exit 0 }
            }
        }
    }
    else {
        Write-Warning-Custom "No existing config, will create"
        $targetConfig = [PSCustomObject]@{
            meta = @{ lastTouchedVersion = $manifest.openclawVersion; lastTouchedAt = (Get-Date -Format 'o') }
            agents = @{ defaults = @{ workspace = "$OpenClawDir\workspace" }; list = @() }
            gateway = @{ port = 18789; mode = "local"; bind = "loopback"; auth = @{ mode = "token"; token = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 40 | ForEach-Object {[char]$_}) } }
        }
    }
    
    # Step 5: Read Source Config
    Write-Step "Step 5: Read Source Config"
    if (-not (Test-Path "$tempDir\openclaw.json")) { throw "Missing openclaw.json" }
    $sourceConfig = Get-Content "$tempDir\openclaw.json" -Raw | ConvertFrom-Json
    Write-Success "Read source config"
    
    # Step 6: Merge Configs
    Write-Step "Step 6: Merge Configurations"
    $mergedConfig = Merge-Config -Source $sourceConfig -Target $targetConfig -AgentId $AgentId
    $mergedConfig.meta.lastTouchedVersion = $manifest.openclawVersion
    $mergedConfig.meta.lastTouchedAt = (Get-Date -Format 'o')
    Write-Success "Config merged"
    
    # Step 7: Write Config
    Write-Step "Step 7: Write Config"
    if (Test-Path $configPath) {
        $backupPath = "$configPath.migration-bak-$timestamp"
        Copy-Item $configPath $backupPath -Force
        Write-Info "Backed up: $backupPath"
    }
    $mergedConfig | ConvertTo-Json -Depth 50 | Out-File $configPath -Encoding utf8
    Write-Success "Config written"
    
    # Step 8: Restore Agent Files
    Write-Step "Step 8: Restore Agent Files"
    $agentDir = "$OpenClawDir\agents\$AgentId"
    $agentConfigDir = "$agentDir\agent"
    if (-not (Test-Path $agentConfigDir)) { New-Item -ItemType Directory -Path $agentConfigDir -Force | Out-Null }
    
    $sourceAgentConfig = "$tempDir\agents\$AgentId\agent"
    if (Test-Path $sourceAgentConfig) {
        Get-ChildItem $sourceAgentConfig -File | ForEach-Object {
            Copy-Item $_.FullName "$agentConfigDir\$($_.Name)" -Force
            Write-Info "  Copied: $($_.Name)"
        }
    }
    
    $sourceSessions = "$tempDir\agents\$AgentId\sessions"
    $targetSessions = "$agentDir\sessions"
    if (Test-Path $sourceSessions) {
        if (-not (Test-Path $targetSessions)) { New-Item -ItemType Directory -Path $targetSessions -Force | Out-Null }
        Get-ChildItem $sourceSessions -File | ForEach-Object {
            Copy-Item $_.FullName "$targetSessions\$($_.Name)" -Force
            Write-Info "  Copied: $($_.Name)"
        }
    }
    Write-Success "Agent files restored"
    
    # Step 9: Restore Workspace
    Write-Step "Step 9: Restore Workspace"
    $sourceWorkspace = "$tempDir\workspace"
    $targetWorkspace = $null
    foreach ($agent in $mergedConfig.agents.list) {
        if ($agent.id -eq $AgentId -and $agent.workspace) { $targetWorkspace = $agent.workspace; break }
    }
    if (-not $targetWorkspace -and $mergedConfig.agents.defaults.workspace) { $targetWorkspace = $mergedConfig.agents.defaults.workspace }
    if (-not $targetWorkspace) { $targetWorkspace = "$OpenClawDir\workspace" }
    
    if (Test-Path $sourceWorkspace) {
        if ((Test-Path $targetWorkspace) -and (-not $Force)) {
            $backupWs = "$targetWorkspace.migration-bak-$timestamp"
            Copy-Item $targetWorkspace $backupWs -Recurse -Force
            Write-Info "Backed up workspace: $backupWs"
        }
        if (-not (Test-Path $targetWorkspace)) { New-Item -ItemType Directory -Path $targetWorkspace -Force | Out-Null }
        
        Get-ChildItem $sourceWorkspace -Recurse -File | ForEach-Object {
            $relPath = $_.FullName.Replace($sourceWorkspace, '').TrimStart('\')
            $destFile = "$targetWorkspace\$relPath"
            $destDir = Split-Path $destFile -Parent
            if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
            Copy-Item $_.FullName $destFile -Force
        }
        $fileCount = (Get-ChildItem $sourceWorkspace -Recurse -File).Count
        Write-Success "Workspace restored ($fileCount files)"
    }
    else { Write-Warning-Custom "Package missing workspace" }
    
    # Step 10: Rebuild Memory Index (optional, with timeout)
    Write-Step "Step 10: Rebuild Memory Index (Optional)"
    Write-Info "Note: This step requires embedding model configuration"
    Write-Info "Skipping for now. You can run manually later if needed."
    Write-Info "Command: openclaw memory index --agent $AgentId --force"
    Write-Success "Memory index skipped (can rebuild manually)"
    
    # Step 11: Stop Gateway (Force - required for file release)
    Write-Step "Step 11: Stop Gateway (Required)"
    Write-Info "Stopping Gateway to release file handles..."
    $gatewayStopped = $false
    try {
        # Try graceful stop first
        & openclaw gateway stop 2>&1 | Out-Host
        Start-Sleep -Seconds 3
        $gatewayStopped = $true
        Write-Success "Gateway stopped (graceful)"
    }
    catch {
        Write-Info "Graceful stop failed, trying force stop..."
    }
    
    # Force kill any remaining gateway processes
    $gatewayProcesses = Get-Process | Where-Object { $_.ProcessName -eq "gateway" -or $_.MainWindowTitle -like "*openclaw*" -or $_.Path -like "*openclaw*" }
    if ($gatewayProcesses) {
        foreach ($p in $gatewayProcesses) {
            try {
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                Write-Info "  Force stopped: $($p.ProcessName) (PID: $($p.Id))"
                $gatewayStopped = $true
            }
            catch {
                Write-Warning-Custom "Failed to stop PID $($p.Id): $($_.Exception.Message)"
            }
        }
        if ($gatewayStopped) {
            Start-Sleep -Seconds 2  # Wait for file handles to release
            Write-Success "All gateway processes stopped"
        }
    }
    else {
        if (-not $gatewayStopped) { Write-Success "Gateway not running" }
    }
    
    # Step 12: Cleanup
    Write-Step "Step 12: Cleanup"
    Remove-Item $tempDir -Recurse -Force
    Write-Success "Cleaned up"
    
    # Step 13: Restart Gateway
    if (-not $NoRestart) {
        Write-Step "Step 13: Restart Gateway"
        Write-Info "Starting Gateway..."
        try {
            & openclaw gateway start 2>&1 | Out-Host
            Start-Sleep -Seconds 3
            Write-Success "Gateway started"
        }
        catch {
            Write-Warning-Custom "Gateway start failed (run manually: openclaw gateway start)"
        }
    }
    else { Write-Step "Import Complete (restart skipped)" }
    
    # Complete
    Write-Step "Import Complete!"
    Write-Success "Agent '$AgentId' imported"
    Write-Host "`nPost-Import:" -ForegroundColor Cyan
    Write-Host "  1. Configure: openclaw secrets configure"
    Write-Host "  2. Validate:  openclaw config validate"
    Write-Host "  3. Verify:    openclaw agents list"
    Write-Host "  4. Test:      Send message and check session"
    
    if ($NoRestart) { Write-Host "`n[WARN] Restart manually: openclaw gateway restart" -ForegroundColor Yellow }
}
catch {
    Write-Error-Custom $_.Exception.Message
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    exit 1
}

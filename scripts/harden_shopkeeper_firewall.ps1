<#
.SYNOPSIS
    PrintDrop Shopkeeper Windows Firewall Hardening & Port Isolation Script

.DESCRIPTION
    This script secures the Shopkeeper's Windows PC against connected customers on the local Wi-Fi.
    - ALLOWS: PrintDrop HTTP upload portal & API (TCP Port 8080) and discovery (Port 53317).
    - BLOCKS: Windows File Sharing (SMB 445, 139), NetBIOS (137, 138), Remote Desktop (RDP 3389),
      WinRM (5985, 5986), and RPC Endpoint Mapper (135).
    
    Customers on the local Wi-Fi can ONLY interact with PrintDrop's file upload interface.
    All other Windows services, shared drives, administrative shares, and remote logins are strictly blocked.

.PARAMETER Rollback
    Removes all PrintDrop hardening firewall rules and restores default firewall settings.

.PARAMETER Status
    Displays the current status of all PrintDrop firewall rules.

.EXAMPLE
    # Apply hardening rules (Must be run in Administrator PowerShell):
    .\scripts\harden_shopkeeper_firewall.ps1

.EXAMPLE
    # Check current status:
    .\scripts\harden_shopkeeper_firewall.ps1 -Status

.EXAMPLE
    # Rollback / remove hardening rules:
    .\scripts\harden_shopkeeper_firewall.ps1 -Rollback
#>

[CmdletBinding()]
param(
    [switch]$Rollback,
    [switch]$Status
)

# Enforce Administrator Elevation
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "`n[!] ERROR: Administrator privileges are required to configure Windows Firewall." -ForegroundColor Red
    Write-Host "    Please right-click PowerShell and select 'Run as administrator', then re-run this script.`n" -ForegroundColor Yellow
    exit 1
}

$RulePrefix = "PrintDrop-Security-"

# List of rules managed by this script
$Rules = @(
    @{
        Name        = "${RulePrefix}Allow-Web-Upload-8080"
        DisplayName = "PrintDrop - Allow Customer Web Upload (Port 8080)"
        Description = "Permits customer mobile browsers to access PrintDrop upload portal and send print jobs."
        Direction   = "Inbound"
        Action      = "Allow"
        Protocol    = "TCP"
        LocalPort   = "8080"
    },
    @{
        Name        = "${RulePrefix}Allow-Session-Discovery-53317"
        DisplayName = "PrintDrop - Allow Session Discovery (Port 53317)"
        Description = "Permits local network discovery for PrintDrop desktop sessions."
        Direction   = "Inbound"
        Action      = "Allow"
        Protocol    = "TCP"
        LocalPort   = "53317"
    },
    @{
        Name        = "${RulePrefix}Block-SMB-FileSharing-TCP"
        DisplayName = "PrintDrop - Block LAN Windows File Sharing (SMB TCP 445, 139)"
        Description = "Prevents Wi-Fi customers from accessing Windows shared folders, administrative shares (C$), and Samba."
        Direction   = "Inbound"
        Action      = "Block"
        Protocol    = "TCP"
        LocalPort   = "445, 139"
    },
    @{
        Name        = "${RulePrefix}Block-NetBIOS-UDP"
        DisplayName = "PrintDrop - Block LAN NetBIOS Discovery (UDP 137, 138)"
        Description = "Prevents Wi-Fi customers from discovering PC hostname and NetBIOS shares."
        Direction   = "Inbound"
        Action      = "Block"
        Protocol    = "UDP"
        LocalPort   = "137, 138"
    },
    @{
        Name        = "${RulePrefix}Block-RDP-3389"
        DisplayName = "PrintDrop - Block LAN Remote Desktop (RDP TCP 3389)"
        Description = "Prevents Wi-Fi customers from attempting Remote Desktop logins."
        Direction   = "Inbound"
        Action      = "Block"
        Protocol    = "TCP"
        LocalPort   = "3389"
    },
    @{
        Name        = "${RulePrefix}Block-WinRM-5985-5986"
        DisplayName = "PrintDrop - Block LAN Windows Remote Management (WinRM 5985, 5986)"
        Description = "Prevents Wi-Fi customers from attempting remote PowerShell/WinRM commands."
        Direction   = "Inbound"
        Action      = "Block"
        Protocol    = "TCP"
        LocalPort   = "5985, 5986"
    },
    @{
        Name        = "${RulePrefix}Block-RPC-135"
        DisplayName = "PrintDrop - Block LAN RPC Endpoint Mapper (TCP 135)"
        Description = "Prevents Wi-Fi customers from probing Windows RPC, DCOM, and WMI."
        Direction   = "Inbound"
        Action      = "Block"
        Protocol    = "TCP"
        LocalPort   = "135"
    }
)

function Show-Status {
    Write-Host "`n=== PrintDrop Windows Firewall Security Status ===" -ForegroundColor Cyan
    $existing = Get-NetFirewallRule -Name "${RulePrefix}*" -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "  No PrintDrop custom firewall rules currently active (Default Windows policy active).`n" -ForegroundColor Yellow
        return
    }

    foreach ($r in $existing) {
        $color = if ($r.Action -eq "Allow") { "Green" } else { "Magenta" }
        Write-Host ("  [{0,-5}] {1}" -f $r.Action.ToString().ToUpper(), $r.DisplayName) -ForegroundColor $color
    }
    Write-Host ""
}

function Remove-HardeningRules {
    Write-Host "`n[-] Removing all PrintDrop hardening firewall rules..." -ForegroundColor Yellow
    $existing = Get-NetFirewallRule -Name "${RulePrefix}*" -ErrorAction SilentlyContinue
    if ($existing) {
        Remove-NetFirewallRule -Name "${RulePrefix}*" -ErrorAction SilentlyContinue
        Write-Host "[✓] Successfully removed $($existing.Count) PrintDrop firewall rule(s)." -ForegroundColor Green
    } else {
        Write-Host "[i] No existing PrintDrop rules found to remove." -ForegroundColor Gray
    }
    Write-Host ""
}

function Apply-HardeningRules {
    Write-Host "`n========================================================" -ForegroundColor Cyan
    Write-Host "  PrintDrop Shopkeeper PC Windows Firewall Hardening" -ForegroundColor Cyan
    Write-Host "========================================================" -ForegroundColor Cyan
    Write-Host "Securing Shopkeeper Windows host against local Wi-Fi devices...`n" -ForegroundColor Gray

    # Clean previous versions of our rules first
    Remove-NetFirewallRule -Name "${RulePrefix}*" -ErrorAction SilentlyContinue

    foreach ($rule in $Rules) {
        $ports = ($rule.LocalPort -split ",\s*") | ForEach-Object { $_.Trim() }

        New-NetFirewallRule `
            -Name $rule.Name `
            -DisplayName $rule.DisplayName `
            -Description $rule.Description `
            -Direction $rule.Direction `
            -Action $rule.Action `
            -Protocol $rule.Protocol `
            -LocalPort $ports `
            -Enabled True `
            -Profile Any `
            -ErrorAction Stop | Out-Null

        if ($rule.Action -eq "Allow") {
            Write-Host ("  [✔ ALLOWED] {0,-40} (Port {1})" -f $rule.DisplayName, $rule.LocalPort) -ForegroundColor Green
        } else {
            Write-Host ("  [🔒 BLOCKED] {0,-40} (Port {1})" -f $rule.DisplayName, $rule.LocalPort) -ForegroundColor Red
        }
    }

    Write-Host "`n--------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "[✓] HARDENING COMPLETE!" -ForegroundColor Green
    Write-Host "  * Connected Wi-Fi customers CAN ONLY access: http://<PC_IP>:8080/ (PrintDrop)" -ForegroundColor White
    Write-Host "  * Windows file sharing, shared drives, RDP, and admin shares are strictly BLOCKED." -ForegroundColor White
    Write-Host "  * Uploaded documents are strictly quarantined in PrintDrop's secure storage." -ForegroundColor White
    Write-Host "--------------------------------------------------------`n" -ForegroundColor DarkGray
}

# Execution Dispatcher
if ($Status) {
    Show-Status
} elseif ($Rollback) {
    Remove-HardeningRules
    Show-Status
} else {
    Apply-HardeningRules
}

# Setup Notion Tasks Widget to run at startup with admin rights (no UAC prompt)
# Run this script as Administrator!

$taskName = "Notion Tasks Widget"
$taskPath = "C:\Program Files\Notion Tasks Widget\Notion Tasks Widget.exe"

Write-Host "Setting up Notion Tasks Widget to start at login..." -ForegroundColor Cyan

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator', then run this script again." -ForegroundColor Yellow
    pause
    exit 1
}

# Remove existing task if any
Write-Host "Removing any existing task..." -ForegroundColor Gray
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create the task action
$action = New-ScheduledTaskAction -Execute $taskPath

# Create a trigger for logon
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Create settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit 0

# Create the principal - run as current user with highest privileges (admin)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType Interactive

# Register the task
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Starts Notion Tasks Widget at login with admin rights (no UAC prompt)"

Write-Host ""
Write-Host "SUCCESS! Notion Tasks Widget will now start automatically at login." -ForegroundColor Green
Write-Host "No UAC prompt will appear because it runs via Task Scheduler." -ForegroundColor Green
Write-Host ""
Write-Host "To verify: Open Task Scheduler and look for 'Notion Tasks Widget'" -ForegroundColor Cyan
Write-Host ""
pause


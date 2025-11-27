# Script to create a GitHub release
param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [Parameter(Mandatory=$true)]
    [string]$GitHubToken,
    
    [string]$ReleaseNotes = ""
)

$owner = "BDicksmusic"
$repo = "Notion-Tasks-Widget"
$tag = "v$Version"
$installerPath = "dist\Notion Tasks Widget Setup $Version.exe"
$blockmapPath = "dist\Notion Tasks Widget Setup $Version.exe.blockmap"

# Create release
$releaseBody = @{
    tag_name = $tag
    name = "v$Version"
    body = if ($ReleaseNotes) { $ReleaseNotes } else { "Release v$Version - Notion import improvements and Search API refactor" }
    draft = $false
    prerelease = $false
} | ConvertTo-Json

$headers = @{
    "Authorization" = "token $GitHubToken"
    "Accept" = "application/vnd.github.v3+json"
}

Write-Host "Creating GitHub release for $tag..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases" -Method Post -Headers $headers -Body $releaseBody -ContentType "application/json"
    $releaseId = $response.id
    Write-Host "Release created successfully! ID: $releaseId" -ForegroundColor Green
    
    # Upload installer
    if (Test-Path $installerPath) {
        Write-Host "Uploading installer..." -ForegroundColor Yellow
        $installerName = "Notion Tasks Widget Setup $Version.exe"
        $uploadUrl = $response.upload_url -replace '\{.*\}', "?name=$installerName"
        
        $fileBytes = [System.IO.File]::ReadAllBytes($installerPath)
        $boundary = [System.Guid]::NewGuid().ToString()
        $bodyLines = @(
            "--$boundary",
            "Content-Disposition: form-data; name=`"file`"; filename=`"$installerName`"",
            "Content-Type: application/octet-stream",
            "",
            [System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($fileBytes),
            "--$boundary--"
        )
        $body = $bodyLines -join "`r`n"
        
        $uploadHeaders = @{
            "Authorization" = "token $GitHubToken"
            "Content-Type" = "multipart/form-data; boundary=$boundary"
        }
        
        Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $uploadHeaders -Body ([System.Text.Encoding]::GetEncoding('iso-8859-1').GetBytes($body))
        Write-Host "Installer uploaded successfully!" -ForegroundColor Green
    } else {
        Write-Host "Warning: Installer not found at $installerPath" -ForegroundColor Yellow
    }
    
    # Upload blockmap if exists
    if (Test-Path $blockmapPath) {
        Write-Host "Uploading blockmap..." -ForegroundColor Yellow
        $blockmapName = "Notion Tasks Widget Setup $Version.exe.blockmap"
        $uploadUrl = $response.upload_url -replace '\{.*\}', "?name=$blockmapName"
        
        $fileBytes = [System.IO.File]::ReadAllBytes($blockmapPath)
        $boundary = [System.Guid]::NewGuid().ToString()
        $bodyLines = @(
            "--$boundary",
            "Content-Disposition: form-data; name=`"file`"; filename=`"$blockmapName`"",
            "Content-Type: application/octet-stream",
            "",
            [System.Text.Encoding]::GetEncoding('iso-8859-1').GetString($fileBytes),
            "--$boundary--"
        )
        $body = $bodyLines -join "`r`n"
        
        $uploadHeaders = @{
            "Authorization" = "token $GitHubToken"
            "Content-Type" = "multipart/form-data; boundary=$boundary"
        }
        
        Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $uploadHeaders -Body ([System.Text.Encoding]::GetEncoding('iso-8859-1').GetBytes($body))
        Write-Host "Blockmap uploaded successfully!" -ForegroundColor Green
    }
    
    Write-Host "`nRelease URL: $($response.html_url)" -ForegroundColor Cyan
} catch {
    Write-Host "Error creating release: $_" -ForegroundColor Red
    exit 1
}


#Requires -Version 7
# Gmail Daily Report — Đọc 100 email, gắn nhãn, báo cáo email quan trọng
[CmdletBinding()] param([switch]$NoNotify)

$credFile  = "$env:USERPROFILE\.gmail-mcp\credentials.json"
$oauthFile = "$env:USERPROFILE\.gmail-mcp\gcp-oauth.keys.json"
$reportDir = "d:\website test\reports"
$maxEmails = 100
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

# ── Token Management ──────────────────────────────────────────────────────────

function Get-ValidToken {
    $creds = Get-Content $credFile -Raw | ConvertFrom-Json
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($creds.expiry_date -gt ($nowMs + 300000)) { return $creds.access_token }

    $oauth  = Get-Content $oauthFile -Raw | ConvertFrom-Json
    $params = @{
        Uri         = "https://oauth2.googleapis.com/token"
        Method      = "POST"
        ContentType = "application/x-www-form-urlencoded"
        Body        = "client_id=$($oauth.installed.client_id)&client_secret=$($oauth.installed.client_secret)&refresh_token=$($creds.refresh_token)&grant_type=refresh_token"
    }
    $r = Invoke-RestMethod @params
    $creds.access_token = $r.access_token
    $creds.expiry_date  = $nowMs + ($r.expires_in * 1000)
    $creds | ConvertTo-Json | Set-Content $credFile -Encoding UTF8
    return $r.access_token
}

# ── Gmail API Helper ──────────────────────────────────────────────────────────

function Invoke-Gmail {
    param([string]$Path, [string]$Method = "GET", [hashtable]$Body = $null)
    $h   = @{ Authorization = "Bearer $(Get-ValidToken)"; "Content-Type" = "application/json" }
    $uri = "https://gmail.googleapis.com/gmail/v1/users/me/$Path"
    if ($Body) { return Invoke-RestMethod -Uri $uri -Method $Method -Headers $h -Body ($Body | ConvertTo-Json -Depth 5) }
    return Invoke-RestMethod -Uri $uri -Method $Method -Headers $h
}

# ── Label Management ──────────────────────────────────────────────────────────

$labelCache = @{}
function Get-OrCreateLabel([string]$Name) {
    if ($labelCache[$Name]) { return $labelCache[$Name] }
    $all  = (Invoke-Gmail "labels").labels
    $existing = $all | Where-Object { $_.name -eq $Name }
    if ($existing) { $labelCache[$Name] = $existing.id; return $existing.id }
    $new = Invoke-Gmail "labels" -Method POST -Body @{
        name                  = $Name
        labelListVisibility   = "labelShow"
        messageListVisibility = "show"
    }
    $labelCache[$Name] = $new.id; return $new.id
}

# ── Email Classifier ──────────────────────────────────────────────────────────

function Get-EmailCategory([string]$Subject, [string]$From, [string]$Snippet, [string[]]$SysLabels) {
    $s = "$Subject $From $Snippet".ToLower()

    # ── KHẨN CẤP ─────────────────────────────────────────────────────────────
    # Cảnh báo bảo mật tài khoản
    if ($From -match "no-reply@accounts\.google\.com|noreply-accounts@google\.com") { return "Urgent" }
    if ($From -match "do-not-reply@ses\.binance\.com|noreply@binance\.com")          { return "Urgent" }
    if ($From -match "no-reply@coinbase\.com|security@.*crypto")                    { return "Urgent" }
    if ($s    -match "cảnh báo|bảo mật|đăng nhập.*mới|new.*sign.?in|security alert|unauthorized|otp|verify.*account") { return "Urgent" }

    # Ngân hàng / giao dịch tài chính
    if ($From -match "vpb\.com\.vn|vietcombank|techcombank|acb\.com\.vn|bidv\.com|mbbank|sacombank|tpbank|ocb\.com\.vn|agribank") { return "Urgent" }
    if ($s    -match "transfer successful|giao dịch.*thành công|số dư tài khoản|tiền đã được.*trừ|thanh toán.*thành công|biến động số dư") { return "Urgent" }

    # Hóa đơn / dịch vụ / hosting
    if ($From -match "vetc\.com\.vn|evn\.com\.vn|vnpt\.vn|viettel\.vn") { return "Urgent" }
    if ($From -match "matbao\.com|mắt bão|invoice@matbao") { return "Urgent" }
    if ($s    -match "hóa đơn|phát hành hóa đơn|invoice|verify.*domain|xác minh.*tên miền") { return "Urgent" }

    # Thanh toán / ví điện tử
    if ($From -match "paypal\.com|service@intl\.paypal|no-reply@momo\.vn|momo\.vn") { return "Urgent" }
    if ($s    -match "account.*deactivated|tài khoản.*bị khóa|permanently.*disabled|giao dịch thành công") { return "Urgent" }

    # Giáo dục / công việc
    if ($From -match "\.edu\.vn|hutech\.edu\.vn") { return "Urgent" }
    if ($s    -match "kết quả.*đăng ký|học phần|điểm thi|thông báo.*lớp|lịch học|lịch thi") { return "Urgent" }

    # Canva / app security changes
    if ($s -match "passkey|mã khóa|xác thực.*tài khoản|thay đổi.*mật khẩu|password.*changed|2fa.*enabled") { return "Urgent" }

    # ── BỎ QUA ────────────────────────────────────────────────────────────────
    if ("CATEGORY_PROMOTIONS" -in $SysLabels) { return "Ignore" }

    if ($From -match "no-reply@grab\.com|shopee|lazada|tiki\.|sendo\.")               { return "Ignore" }
    if ($From -match "playstation|nintendo|steam|xbox|epicgames")                     { return "Ignore" }
    if ($From -match "alibaba\.com|aliexpress|amazon.*noreply")                       { return "Ignore" }
    if ($s    -match "giảm giá|khuyến mãi|flash sale|deal.*hấp dẫn|ưu đãi.*hôm nay|mua ngay|đặt ngay.*giảm") { return "Ignore" }
    if ($s    -match "days of play|mega sale|siêu sale|big sale|double day")          { return "Ignore" }
    if ($Subject -match "^Re: Unsubscribe|newsletter.*unsubscribe") { return "Ignore" }

    # Onboarding tự động không cần xem
    if ($From -match "github\.com|no-reply@github" -and $s -match "get started|first repository|first pull request|welcome to github") { return "Ignore" }

    # ── ĐỌC SAU ───────────────────────────────────────────────────────────────
    if ($From -match "newsletter@|briefing@|digest@|weekly@|daily@") { return "Read-Later" }
    if ($From -match "cryptobriefing\.com|coindesk|cointelegraph|decrypt\.co") { return "Read-Later" }
    if ($From -match "interactivebrokers\.com|vndirect|fpt\.com\.vn")          { return "Read-Later" }
    if ($From -match "github\.com|gitlab|vercel|netlify|cloudflare")           { return "Read-Later" }
    if ($From -match "facebookmail\.com|groupupdates@|linkedin\.com")          { return "Read-Later" }
    if ($From -match "google-noreply@google\.com|noreply@google\.com")         { return "Read-Later" }

    return "Read-Later"
}

# ── Windows Toast Notification ────────────────────────────────────────────────

function Show-Toast([string]$Title, [string]$Body) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $n = New-Object System.Windows.Forms.NotifyIcon
        $n.Icon    = [System.Drawing.SystemIcons]::Information
        $n.Visible = $true
        $n.ShowBalloonTip(10000, $Title, $Body, [System.Windows.Forms.ToolTipIcon]::Info)
        Start-Sleep -Seconds 1
        $n.Dispose()
    } catch {}
}

# ── MAIN ──────────────────────────────────────────────────────────────────────

Write-Host "`n$(Get-Date -Format 'HH:mm:ss') Đang tải $maxEmails email..." -ForegroundColor Cyan

$ids = (Invoke-Gmail "messages?maxResults=$maxEmails&labelIds=INBOX").messages.id
Write-Host "$(Get-Date -Format 'HH:mm:ss') Đã lấy $($ids.Count) email — chuẩn bị phân loại & gắn nhãn...`n" -ForegroundColor Cyan

$urgentId    = Get-OrCreateLabel "AMZ/Khẩn Cấp"
$readLaterId = Get-OrCreateLabel "AMZ/Đọc Sau"
$ignoreId    = Get-OrCreateLabel "AMZ/Bỏ Qua"

$buckets = @{ Urgent = [System.Collections.Generic.List[object]]::new()
              "Read-Later" = [System.Collections.Generic.List[object]]::new()
              Ignore = [System.Collections.Generic.List[object]]::new() }

$i = 0
foreach ($id in $ids) {
    $msg  = Invoke-Gmail "messages/$id`?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date"
    $subj = ($msg.payload.headers | Where-Object name -eq "Subject").value
    $from = ($msg.payload.headers | Where-Object name -eq "From").value
    $date = ($msg.payload.headers | Where-Object name -eq "Date").value
    $snip = $msg.snippet -replace '\s+', ' '

    $cat     = Get-EmailCategory -Subject $subj -From $from -Snippet $snip -SysLabels $msg.labelIds
    $labelId = switch ($cat) { "Urgent" { $urgentId } "Read-Later" { $readLaterId } "Ignore" { $ignoreId } }

    Invoke-Gmail "messages/$id/modify" -Method POST -Body @{ addLabelIds = @($labelId); removeLabelIds = @() } | Out-Null

    $buckets[$cat].Add([PSCustomObject]@{
        From    = ($from -replace '"', '')
        Subject = $subj
        Date    = $date
        Unread  = "UNREAD" -in $msg.labelIds
        Snippet = if ($snip.Length -gt 130) { $snip.Substring(0,130) + "…" } else { $snip }
    })

    $i++
    if ($i % 20 -eq 0) { Write-Host "  [$i / $($ids.Count)] đã xử lý..." -ForegroundColor Gray }
}

# ── Tạo báo cáo ───────────────────────────────────────────────────────────────

$today      = Get-Date -Format "yyyy-MM-dd"
$timestamp  = Get-Date -Format "dd/MM/yyyy HH:mm"
$reportFile = "$reportDir\email-report-$today.txt"

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("═══════════════════════════════════════════════════════════════")
$lines.Add("  BÁO CÁO EMAIL HÀNG NGÀY — $timestamp")
$lines.Add("  goldmenvt@gmail.com")
$lines.Add("═══════════════════════════════════════════════════════════════")
$lines.Add("")
$lines.Add("  TỔNG: $($ids.Count) email  |  🔴 Khẩn Cấp: $($buckets.Urgent.Count)  |  🟡 Đọc Sau: $($buckets['Read-Later'].Count)  |  ⚪ Bỏ Qua: $($buckets.Ignore.Count)")
$lines.Add("")
$lines.Add("───────────────────────────────────────────────────────────────")
$lines.Add("  🔴 KHẨN CẤP ($($buckets.Urgent.Count) email) — Cần xem ngay")
$lines.Add("───────────────────────────────────────────────────────────────")

if ($buckets.Urgent.Count -eq 0) {
    $lines.Add("  (Không có email khẩn cấp hôm nay)")
} else {
    foreach ($e in $buckets.Urgent) {
        $mark = if ($e.Unread) { "●" } else { "○" }
        $lines.Add("")
        $lines.Add("  $mark Từ     : $($e.From)")
        $lines.Add("    Tiêu đề: $($e.Subject)")
        $lines.Add("    Ngày   : $($e.Date)")
        $lines.Add("    Preview: $($e.Snippet)")
    }
}

$lines.Add("")
$lines.Add("───────────────────────────────────────────────────────────────")
$unreadRL = $buckets['Read-Later'] | Where-Object { $_.Unread }
$lines.Add("  🟡 ĐỌC SAU — Chưa đọc ($($unreadRL.Count) / $($buckets['Read-Later'].Count))")
$lines.Add("───────────────────────────────────────────────────────────────")
foreach ($e in $unreadRL) {
    $lines.Add("  ● $($e.Subject)")
    $lines.Add("    $($e.From)")
}

$lines.Add("")
$lines.Add("───────────────────────────────────────────────────────────────")
$lines.Add("  ⚪ BỎ QUA ($($buckets.Ignore.Count) email — nhãn AMZ/Bỏ Qua trong Gmail)")
$lines.Add("───────────────────────────────────────────────────────────────")
foreach ($e in $buckets.Ignore) {
    $lines.Add("  · $($e.Subject) — $($e.From)")
}

$lines.Add("")
$lines.Add("═══════════════════════════════════════════════════════════════")
$lines.Add("  Báo cáo lưu tại: $reportFile")
$lines.Add("═══════════════════════════════════════════════════════════════")

$report = $lines -join "`n"
$report | Out-File -FilePath $reportFile -Encoding UTF8

Write-Host $report -ForegroundColor White
Write-Host "`n✅ Nhãn Gmail đã được áp dụng. Báo cáo: $reportFile`n" -ForegroundColor Green

if (-not $NoNotify) {
    $msg = "🔴 $($buckets.Urgent.Count) khẩn cấp  ·  🟡 $($buckets['Read-Later'].Count) đọc sau  ·  ⚪ $($buckets.Ignore.Count) bỏ qua"
    Show-Toast -Title "Gmail Daily Report — $timestamp" -Body $msg
}

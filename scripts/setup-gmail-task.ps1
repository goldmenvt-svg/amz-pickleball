# Setup Windows Task Scheduler — Gmail Daily Report
# Chạy script này MỘT LẦN với quyền Administrator để đăng ký scheduled task

$taskName   = "Gmail Daily Report"
$scriptPath = "d:\website test\scripts\gmail-daily-report.ps1"
$logPath    = "d:\website test\reports\task-scheduler.log"

$action  = New-ScheduledTaskAction `
    -Execute "pwsh.exe" `
    -Argument "-NonInteractive -WindowStyle Hidden -File `"$scriptPath`" >> `"$logPath`" 2>&1"

# Chạy mỗi ngày lúc 08:00 sáng giờ Việt Nam (máy tính phải set timezone Asia/Ho_Chi_Minh)
$trigger = New-ScheduledTaskTrigger -Daily -At "08:00"

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -StartWhenAvailable `
    -WakeToRun:$false `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Highest

# Xóa task cũ nếu có
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName  $taskName `
    -Action    $action `
    -Trigger   $trigger `
    -Settings  $settings `
    -Principal $principal `
    -Description "Đọc 100 email inbox Gmail, gắn nhãn Khẩn Cấp/Đọc Sau/Bỏ Qua, xuất báo cáo hàng ngày" `
    | Out-Null

Write-Host "`n✅ Đã đăng ký scheduled task: '$taskName'" -ForegroundColor Green
Write-Host "   Lịch chạy : Mỗi ngày lúc 08:00 sáng" -ForegroundColor Cyan
Write-Host "   Script    : $scriptPath" -ForegroundColor Cyan
Write-Host "   Log file  : $logPath`n" -ForegroundColor Cyan

# Xác nhận task đã được tạo
$task = Get-ScheduledTask -TaskName $taskName
Write-Host "   Trạng thái: $($task.State)" -ForegroundColor Yellow
Write-Host "   Chạy thử ngay? (Y/N): " -NoNewline -ForegroundColor White
$run = Read-Host
if ($run -eq "Y" -or $run -eq "y") {
    Start-ScheduledTask -TaskName $taskName
    Write-Host "`n▶ Đang chạy... Kiểm tra báo cáo tại d:\website test\reports\" -ForegroundColor Green
}

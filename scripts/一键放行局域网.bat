@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  一键修好手机连不上（需要管理员权限，会自动提权）
rem  做的事：
rem    1. 放行 TCP 端口（默认 3000）的入站连接
rem    2. 把当前的 Wi-Fi 从「公共网络」改成「专用网络」
rem       —— Windows 11 上不做这一步，即使加了防火墙规则也不生效
rem    3. 打印最终状态，供你核对
rem ============================================================

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3000"

net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo 正在请求管理员权限...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%PORT%' -Verb RunAs"
    exit /b
)

echo.
echo [1/2] 放行 TCP %PORT% 入站（专用网络 / 域网络）...
netsh advfirewall firewall delete rule name="KaiTuoYiShi LAN %PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="KaiTuoYiShi LAN %PORT%" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain
if errorlevel 1 (
    echo     失败：请确认是以管理员身份运行
) else (
    echo     成功
)

echo.
echo [2/2] 把 Wi-Fi 网络类型改为「专用网络」...
powershell -NoProfile -Command "$p = Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -like 'WLAN*' -and $_.NetworkCategory -eq 'Public' }; if ($p) { foreach ($x in $p) { try { Set-NetConnectionProfile -InterfaceAlias $x.InterfaceAlias -NetworkCategory Private -ErrorAction Stop; Write-Host ('    已改为专用: ' + $x.Name) } catch { Write-Host ('    修改失败: ' + $x.Name + ' -> ' + $_.Exception.Message) } } } else { Write-Host '    当前 Wi-Fi 不是公共网络，无需修改' }"

echo.
echo ====== 核对 ======
netsh advfirewall firewall show rule name="KaiTuoYiShi LAN %PORT%" | findstr /C:"规则名称" /C:"Rule Name" /C:"已启用" /C:"Enabled" /C:"操作" /C:"Action"
echo.
powershell -NoProfile -Command "Get-NetConnectionProfile | ForEach-Object { Write-Host ('  ' + $_.Name + '  [' + $_.NetworkCategory + ']') }"
echo.
echo 手机与电脑连同一个 Wi-Fi 后，打开游戏首页打印的局域网链接即可。
echo （设置 - 局域网游玩 里有二维码，扫码直达）
echo.
pause

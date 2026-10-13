@echo off
setlocal

set PORT=3000
if not "%~1"=="" set PORT=%~1

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   需要管理员权限才能修改防火墙规则，正在重新以管理员身份启动...
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%PORT%' -Verb RunAs"
  exit /b
)

echo.
echo   为「开拓轶事 · 局域网游玩」放行入站 TCP 端口 %PORT%
echo.

netsh advfirewall firewall delete rule name="KaiTuoYiShi LAN %PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="KaiTuoYiShi LAN %PORT%" dir=in action=allow protocol=TCP localport=%PORT%

if %errorlevel% equ 0 (
  echo   已放行：TCP %PORT%（入站）。
  echo   手机连同一 Wi-Fi 后即可访问。若换了端口，用：本脚本 新端口号
) else (
  echo   添加失败，请确认以管理员身份运行。
)

echo.
pause
endlocal

@echo off
setlocal
chcp 936 >nul
echo.
echo   存档更新工具
echo   --------------------------------------------------
echo   把旧规则的存档更新为新规则（缩小体积，防 IDB 读不动）。
echo.
echo   · 默认【预演】：只看会做什么，不改任何文件
echo   · 加 --执行 才真正写入（会删除旧节点，不可逆）
echo   · 执行前请先【关闭游戏】并【备份 save 目录】
echo.
echo   用法示例：
echo     node 存档更新工具.mjs                  （预演）
echo     node 存档更新工具.mjs --执行            （执行）
echo     node 存档更新工具.mjs "D:\某处\save" --执行
echo.
node "%~dp0存档更新工具.mjs" %*
echo.
pause
endlocal

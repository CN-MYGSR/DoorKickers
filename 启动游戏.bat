@echo off
chcp 65001 >nul
title 破门而入 2D - 北方特遣队（同人致敬版）
cd /d "%~dp0"

echo.
echo   ============================================
echo    破门而入 2D  ·  北方特遣队（同人致敬版）
echo   ============================================
echo.

REM 优先用系统默认浏览器直接打开（本项目是纯 HTML5，无需任何构建/服务器）
start "" "index.html"

echo   已尝试用默认浏览器打开 index.html
echo.
echo   如果浏览器没有自动弹出，请手动双击本目录下的 index.html
echo.
echo   （如果双击后页面空白或按键无反应，请检查浏览器是否禁用了本地 JS；
echo     推荐使用 Chrome / Edge 打开。）
echo.
pause

@echo off
chcp 65001>nul
title 启动 MC 世界（小鲲鱼的服务器）
cd /d %~dp0
node scripts\mc-online.mjs
echo.
pause
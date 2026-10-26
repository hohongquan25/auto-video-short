@echo off
chcp 65001 >nul
rem Story Studio chạy trong lúc cửa sổ này còn mở; đóng cửa sổ là tắt Story Studio.
title Story Studio
cd /d "%~dp0"
"%~dp0runtime\node\node.exe" "%~dp0server\server.mjs"
if errorlevel 1 (
  echo.
  echo Story Studio đã dừng vì lỗi ở trên. Chụp màn hình cửa sổ này gửi người bán để được hỗ trợ.
  pause
)

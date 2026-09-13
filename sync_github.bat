@echo off
chcp 65001 >nul
rem Cursor Origin 仓库，添加github远程、拉取、创建/重置 github-main 分支
rem 仓库地址：https://github.com/zhiyuan1984/KOL.git

rem 检查是否存在github远程
git remote | findstr /r "^github$" >nul
if %errorlevel% neq 0 (
    git remote add github https://github.com/zhiyuan1984/KOL.git
    echo ✅ 已添加 remote github
) else (
    echo ℹ️ remote github 已存在，跳过添加
)

echo.
echo 📥 正在 fetch github 远端代码
git fetch github

echo.
echo 🔄 创建/重置本地分支 github-main 指向 github/main
git checkout -B github-main github/main

echo.
echo ✅ github-main 分支准备完成，跟踪 github/main
pause

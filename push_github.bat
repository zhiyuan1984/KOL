@echo off
chcp 65001 >nul
echo ======================================
echo 自动提交并推送代码到 github/main
echo ======================================
echo.

:: 添加远程仓库，存在则跳过
git remote add github https://github.com/zhiyuan1984/KOL.git 2>nul

:: 把所有变更加入暂存
git add .
echo 已执行 git add .

  git config --global user.email "qiyouhuang@163.com"
  git config --global user.name "zhiyuan1984"

:: 提交本地代码，自动生成commit信息（可自定义）
git commit -m "auto commit: update code"
echo 已本地commit

:: 推送HEAD到github main分支
git push -u github HEAD:main

echo.
echo 执行完毕
pause

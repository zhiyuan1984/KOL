@echo off
chcp 65001 >nul
echo ======================================
echo 自动提交并推送代码到 github/main (SSH模式)
echo ======================================
echo.
:: 【修改点】远程仓库地址改为SSH地址
git remote add github git@github.com:zhiyuan1984/KOL.git 2>nul
:: 把所有变更加入暂存
git add .
echo 已执行 git add .
git config --global user.email "qiyouhuang@163.com"
git config --global user.name "zhiyuan1984"
:: SSH模式不再依赖http.postBuffer，这条可以保留也可以删掉，我保留给你参考
git config --global http.postBuffer 524288000
:: 提交本地代码，自动生成commit信息（可自定义）
git commit -m "auto commit: update code"
echo 已本地commit
:: 推送HEAD到github main分支
git push -u github HEAD:main
echo.
echo 执行完毕
pause

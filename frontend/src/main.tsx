import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./composer.css";

// 每次部署都会换掉带 hash 的 chunk 文件名，旧标签页再去加载懒加载路由时拿到的是已删除的文件。
// nginx 的 SPA 回退会把它回成 index.html（浏览器按 MIME 拒绝执行），Vite 因此派发
// vite:preloadError —— 自愈一次：硬刷新拿新资产（时间窗防循环；已被路由错误边界兜住的情况
// 会显示「刷新页面」的恢复入口）。
const RELOAD_KEY = "kol:preload-reload-at";
window.addEventListener("vite:preloadError", () => {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - last < 20_000) return;
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* 私密模式：忽略 */
  }
  location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

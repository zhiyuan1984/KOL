# Lucas 头像库

下表使用动画版 WebP；同目录还保留了同名透明 PNG，便于在其他界面中复用。头像从上到下编号为 `Lucas1` 至 `Lucas9`。

| | | |
|:---:|:---:|:---:|
| ![Lucas1](frontend/public/avatars/lucas/Lucas1.webp)<br>`Lucas1` | ![Lucas2](frontend/public/avatars/lucas/Lucas2.webp)<br>`Lucas2` | ![Lucas3](frontend/public/avatars/lucas/Lucas3.webp)<br>`Lucas3` |
| ![Lucas4](frontend/public/avatars/lucas/Lucas4.webp)<br>`Lucas4` | ![Lucas5](frontend/public/avatars/lucas/Lucas5.webp)<br>`Lucas5` | ![Lucas6](frontend/public/avatars/lucas/Lucas6.webp)<br>`Lucas6` |
| ![Lucas7](frontend/public/avatars/lucas/Lucas7.webp)<br>`Lucas7` | ![Lucas8](frontend/public/avatars/lucas/Lucas8.webp)<br>`Lucas8` | ![Lucas9](frontend/public/avatars/lucas/Lucas9.webp)<br>`Lucas9` |

## 使用方式

静态版本：

```html
<img src="/avatars/lucas/Lucas1.png" width="48" height="48" alt="Lucas" />
```

动画版本（自带轻微呼吸与上下浮动效果，并尊重系统的“减少动态效果”设置）：

```html
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="/avatars/lucas/Lucas1.png" />
  <img src="/avatars/lucas/Lucas1.webp" width="48" height="48" alt="Lucas" />
</picture>
```

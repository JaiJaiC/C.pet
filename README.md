# C.pet

> 一只常驻桌面右下角的桌面宠物：点一下就能记 TODO，还带系统监控和一堆小工具。
> Windows / Electron / 免安装单文件 exe。

<p align="center">
  <img src="assets/pet.png" alt="C.pet desktop pet" width="260">
</p>

## 下载

不想折腾代码，直接下 exe：

**[⬇️ 下载 C.pet.exe（Windows 64 位，免安装）](https://github.com/JaiJaiC/C.pet/releases/latest/download/C.pet.exe)**

双击就能跑，不写系统目录、不需要管理员权限。数据存在 `%APPDATA%\c-pet`，
删掉 exe 就等于卸载（想彻底清干净再删这个文件夹）。

> 首次运行 Windows 会弹 SmartScreen「已保护你的电脑」——因为没有买代码签名证书。
> 点「更多信息」→「仍要运行」即可。

中文图文教程在 **[docs/index.html](docs/index.html)**（也可以看[在线版](https://jaijaic.github.io/C.pet/)）。

## 它长什么样

- 一只透明置顶的小宠物，固定在桌面右下角，不挡任务栏。
- 点一下宠物 → 打开 / 收起待办面板（自动居中到主屏）。
- 按住拖动 → 挪到任意位置，甚至能"滑"到任务栏后面只露个头。
- 滚轮 → 20% ~ 135% 随意缩放。
- 每 30 秒自己换个姿势：挠头、抱臂、竖大拇指、打哈欠、敬礼…… 共 15 个动作。

## 功能

| 模块 | 能做什么 |
| --- | --- |
| **To Do / Idea** | 两套列表一键切换；行内编辑、勾选完成、删除；完成时可在 8 秒内撤销；自动记录到「completed database」 |
| **快速链接** | 面板底部可以加自己的常用网址，点击用 Edge 打开 |
| **Monitor** | CPU、内存、磁盘、GPU、网络收发、进程数、开机时长、空闲时间、Temp 目录占用，每 0.45 秒刷新 |
| **Tools** | 扫描同目录 `scripts\` 里的 exe，做成按钮一键启动（详见下文） |
| **Settings** | 大小、自动动作、9 种粒子特效、置顶、开机自启、快捷键改键、位置复位、数据看板、退出 |

### 待办面板

- 标题栏右边的 `Idea` 按钮在两套列表之间切换，各自独立存储，互不干扰。
- 勾选完成的条目会写进 `completed database`（带完成日期），可以逐条删除或一键清空。
- 面板高度随内容自动伸缩，不会留一大片空白。

### 系统监控

数据来源是 Node 的 `os` 模块 + Windows 性能计数器（`Get-Counter`）。GPU 和网速依赖计数器，
某些精简版系统 / 驱动会取不到数值，此时显示 `—`，其它指标照常。

### 工具箱（可选）

程序启动时会依次在 exe 所在目录、上一级目录、`scripts\` 子目录里找这几个文件：

```
Clean_Cache.exe            清理缓存
Merge_PDF.exe              合并 PDF
PPT_To_HTML.exe            PPT 转 HTML
Remove_gray_background.exe 去灰底
Word2Pdf_Tool.exe          Word 转 PDF
生成Index.exe              生成 Index（当前禁用）
```

**仓库里不包含这些 exe**（每个几十 MB，且是我的私人小工具）。你想用这个面板，
把自己的 exe 按上面的文件名放进 exe 旁边的 `scripts\` 文件夹即可；没有 `scripts\` 时
Tools 面板会提示目录不存在，其它功能不受影响。

## 快捷键

| 快捷键 | 作用 | 备注 |
| --- | --- | --- |
| `Ctrl` + `.` | 快速唤出 / 隐藏待办 | 默认值，可在设置里点按钮后直接按新组合改键 |
| `Ctrl` + `/` | 退出 C.pet | 全局生效 |
| `Shift` + `↑` `↓` `←` `→` | 每次 4px 微调宠物位置 | 只在点过宠物或待办面板后生效，别的软件里 `Shift` + 方向键仍是选文字 |
| 鼠标拖动 | 移动宠物 | 松手位置会记住 |
| 滚轮（悬停宠物） | 缩放 | 20% ~ 135% |

`Ctrl` + `.` 用的是白名单式的键盘钩子（`SetWindowsHookEx`），优先级比普通全局快捷键高，
所以能抢在输入法、IDE 之前响应；如果仍被占用，设置面板会提示并允许换一个。

## 数据放在哪

| 内容 | 位置 |
| --- | --- |
| 待办 / 想法 / 快捷链接 / 皮肤设置 | `%APPDATA%\c-pet\Local Storage`（Electron 的 localStorage） |
| 窗口位置、设置、完成记录 | `%APPDATA%\c-pet\settings.json`、`window-state.json`、`completed-tasks.json` |
| 开机自启 | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`（在设置里关掉即可移除） |

升级 exe 不会丢数据——存储路径固定为 `%APPDATA%\c-pet`，和你用哪个版本的 exe 无关。

## 从源码跑

需要 Node.js 18+（开发时用的是 Node 22）。

```bash
npm install
npm start
```

## 自己打包 exe

```bash
npm install
npm run dist      # 产物：dist\C.pet.exe（单文件免安装版）
npm run pack      # 只出 dist\win-unpacked\ 目录版，调试用
```

打包用的是 electron-builder（`package.json` 的 `build` 字段）。两个坑已经踩好并写进配置：

- `electronDist: "node_modules/electron/dist"`：离线复用本地 Electron，不去网上重新下 100MB。
- `signAndEditExecutable: false`：跳过 rcedit / 签名，没有证书也能出包。

如果第一次打包卡在下载 NSIS，可以指定一个可写的缓存目录再跑：

```powershell
$env:ELECTRON_BUILDER_CACHE="D:\cache\electron-builder"
npm run dist
```

## 目录结构

```
main.js         Electron 主进程：窗口、全局快捷键、IPC、性能采样、工具启动
preload.js      contextBridge 暴露的 window.cpet API
index.html      宠物窗口（透明、置顶、无边框）
app.js          宠物动作 / 拖拽 / 缩放 / 特效
note.html       待办面板 + monitor + tools + settings + database 五个视图
note.js         面板全部逻辑（列表、快捷链接、监控轮询、设置同步）
styles.css      深色主题、粒子特效、面板样式
assets/         15 个动作立绘 + 任务栏图标（*-chroma.png 是抠图中间产物，见 .gitignore）
docs/           图文教程（GitHub Pages 直接托管）
```

## 已知限制

- 只做了 Windows 端（用到了 `SetWindowsHookEx`、`Get-Counter`、`shell.writeShortcutLink`）。
- 没有自动更新，升级要手动下新 exe，数据不会丢。
- 性能监控在虚拟机 / 远程桌面里可能取不到 GPU 数据。
- Tools 面板的 exe 是我的私人工具，不随仓库分发。

## 开发者备注

- 单实例锁：重复双击 exe 不会开第二个，而是把已有宠物叫到前台。
- 进入全屏应用（游戏、全屏视频）时宠物自动隐藏，退出全屏后恢复。
- 便携版会把 exe 位置的 `C.pet.lnk` 和已固定的任务栏快捷方式指向当前 exe，移动 exe 后不会失效。

## English

A lightweight Windows desktop pet built with Electron: a transparent always-on-top sprite
that opens an inline To-Do panel on click, with a system monitor, a launcher for local
command-line tools, 15 idle actions and 9 particle effects. Download the portable
`C.pet.exe` from [Releases](https://github.com/JaiJaiC/C.pet/releases/latest/download/C.pet.exe).
Source: `npm install && npm start`, or `npm run dist` to rebuild the single-file exe.

## License

[MIT](LICENSE) © 2026 JaiJaiC

# dsh-mcp-manager

在 dsh 桌面版 GUI 中查看并管理当前 profile 的 MCP 服务器
（即 `cordis.patch.yml` 中 `@deepseek-ai/dsh-mcp-client` 的 insert 行）。

## 这是什么

dsh 的 MCP 客户端把每个 MCP 服务器声明为一条 profile patch 的 insert 行。
官方设置页对这类 union 行没有感知，手工改文件又容易踩坑（被顶层 override 行遮蔽等）。
本插件补上这一缺口：

- **Host 半**（`lib/index.js`）：在 dsh 的 `/api` 认证通道下挂一条 fetch 路由
  `/api/mcp-config`，提供 `list` / `save` / `remove` 三种操作。写入时直接用
  yaml 的 Document API 在 `cordis.patch.yml` 里就地改写目标行，因此注释、缩进、
  折行与 `!!js` 表达式全部原样保留；落盘走 dsh 自己的原子写 + 文件锁。
- **Client 半**（`lib/client.js`）：桌面 GUI 中的「MCP 服务器」页面。可列出当前
  profile 的全部 MCP 服务器，查看其 serverName / 传输方式 / 目标 / 工具数 / 运行状态，
  点「新增服务器」按表单填写后直接追加一行（行 id 默认由 serverName 派生，可手改），
  编辑并保存配置（热重载，无需重启），启用或停用，从 `{"mcpServers": {...}}` 片段
  批量导入，以及删除（删除前自动备份原文到同目录 `.bak`）。

界面文案内置中文与英文两套，跟随 dsh 主题 token 适配外观。

## 仓库结构

```
dsh-mcp-manager/
├── package.json          # bundle 元数据，声明 dsh.bundle.patch 与 dsh.client
├── cordis.patch.yml      # 把本插件作为一条 Loader 行插入 profile
├── lib/
│   ├── index.js          # Host 半：/api/mcp-config 路由与 patch 行读写
│   └── client.js         # Client 半：GUI「MCP 服务器」页面
├── node_modules/         # 安装时由 pnpm 装入（已 gitignore，不入库）
├── .gitignore
├── LICENSE               # MIT
└── README.md
```

依赖全部写在 `package.json` 里，仓库不携带 `node_modules/`：

| 依赖 | 声明位置 | 由谁提供 |
|---|---|---|
| `yaml` | `dependencies` | 安装插件时 pnpm 装进 profile `node_modules` |
| `@deepseek-ai/dsh-atomic-write` | `peerDependencies` + `devDependencies` | 运行中的 dsh 运行时闭包（同一份实例，不与宿主重复加载） |

`dsh-atomic-write` 声明为 peer 而非 dependency，是让它由宿主供给单一实例，
插件仓库因此既不需要、也不应该携带 `node_modules`。

## 安装与启用

本插件是 dsh bundle，由 dsh 桌面版按 `package.json` 中的 `dsh` 字段识别并加载：

- `dsh.bundle.patch` 指向 `cordis.patch.yml`，由 Host 半作为一条 Loader 行注册。
- `dsh.client` 声明 `platform: web` 与 inject 目标，由 dsh 客户端模块系统把
  `lib/client.js` 作为浏览器半侧送出。

通过 dsh 插件管理器或 `dsh plugin --profile <profile> add <本仓库地址>` 安装：pnpm 会按
`dependencies` 自动装上 `yaml`（peer 由宿主供给，pnpm 不装）。加载后在左侧导航出现「MCP 服务器」。

> 本地开发若用 `link:` 挂载源码目录，pnpm 不会安装本插件的 `dependencies`；此时需在插件
> 目录内执行一次 `pnpm install` 得到本地 `node_modules`（已 gitignore），解析时插件自身
> 的 `node_modules` 优先级最高。用 `github:` / tarball 地址安装则依赖自动装进 profile，
> 无需此步。

## 能力边界

- 支持 `stdio` 与 `streamable-http` 两种传输方式的查看、编辑与新增。
- 新增：列表页右上角「新增服务器」→ 填表单 → 保存即在 `cordis.patch.yml` 末尾追加
  一个 `- insert:` 块（带生成时间注释），无需手工编辑文件。
- 删除：删除前回报「会一并删掉的注释行数」供确认，并把原文备份到同目录 `.bak`。
- 写入只改目标行（就地逐键合并），注释、缩进、折行与 `!!js` 表达式保持原样。

## 许可证

[MIT](./LICENSE)

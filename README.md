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
├── node_modules/         # 自带运行时依赖（已 gitignore，不入库）
├── .gitignore
├── LICENSE               # MIT
└── README.md
```

`node_modules/` 内含本插件运行所需的 `@deepseek-ai/dsh-atomic-write` 与 `yaml`，
随插件自带（第三方 bundle 无法从自身位置解析 dsh 安装内的包），因此不纳入版本库。

## 安装与启用

本插件是 dsh bundle，由 dsh 桌面版按 `package.json` 中的 `dsh` 字段识别并加载：

- `dsh.bundle.patch` 指向 `cordis.patch.yml`，由 Host 半作为一条 Loader 行注册。
- `dsh.client` 声明 `platform: web` 与 inject 目标，由 dsh 客户端模块系统把
  `lib/client.js` 作为浏览器半侧送出。

将本目录放入 dsh 的插件目录并重启 DSH 即可；加载后在左侧导航出现「MCP 服务器」。

## 能力边界

当前阶段聚焦于「读 + 改已存在的行 + 删除 + JSON 导入」：

- 支持 `stdio` 与 `streamable-http` 两种传输方式的查看与编辑。
- 增删行属于后续阶段：新增可直接复制「新增服务器模板」后在 `cordis.patch.yml`
  中手工加入；删除已支持（含注释清理与 `.bak` 备份）。

## 许可证

[MIT](./LICENSE)

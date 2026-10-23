# dsh-mcp-manager

在 dsh 桌面版 GUI 中查看并管理 MCP 服务器：profile 级（`cordis.patch.yml` 中
`@deepseek-ai/dsh-mcp-client` 的 insert 行）与**项目级**（项目根目录的 `.dsh/mcp.yml`）。

## 这是什么

dsh 的 MCP 客户端把每个 MCP 服务器声明为一条 profile patch 的 insert 行。
官方设置页对这类 union 行没有感知，手工改文件又容易踩坑（被顶层 override 行遮蔽等）。
本插件补上这一缺口：

- **Host 半**（`lib/index.js`）：在 dsh 的 `/api` 认证通道下挂一条 fetch 路由
  `/api/mcp-config`，提供 `list` / `save` / `remove` 三种操作。写入时直接用
  yaml 的 Document API 在 `cordis.patch.yml` 里就地改写目标行，因此注释、缩进、
  折行与 `!!js` 表达式全部原样保留；落盘走 dsh 自己的原子写 + 文件锁。
  同一路由还提供 `project/read` / `project/save` / `project/merge` 项目级操作，
  以及卡片用的 `project/update` / `project/remove` / `project/toggle`，
  并在会话创建时把项目服务器挂进该会话的 scope。
- **Client 半**（`lib/client.js`）：桌面 GUI 中的「MCP 服务器」页面，分两个 tab。
  **全局**：列出当前 profile 的全部 MCP 服务器，查看其 serverName / 传输方式 /
  目标 / 工具数 / 运行状态，点「新增服务器」按表单填写后直接追加一行（行 id 默认
  由 serverName 派生，可手改），编辑并保存配置（热重载，无需重启），启用或停用，
  从 `{"mcpServers": {...}}` 片段批量导入，以及删除（删除前自动备份原文到同目录 `.bak`）。
  **项目**：选一个工作区，同样一条服务器一张卡片——可新增、编辑、启用/停用、删除，
  动作直接写入该项目的 `.dsh/mcp.yml`（删除前备份、保留其余注释）；页面最下方另有
  默认折叠的「源码」区，用来手改注释、`disableGlobal` 或整份文本。

界面文案内置中文与英文两套，跟随 dsh 主题 token 适配外观。

## 项目级 MCP

「项目」在 dsh 里只有一个含义：**会话的工作目录**。插件从会话 cwd 向上找第一个含
`.git` 的目录作为项目根（与 `.dsh/skills` 的判定一致；找不到 `.git` 时就是 cwd 本身），
再读该目录下的 `.dsh/mcp.yml`：

```yaml
# 项目级 MCP 服务器：只对本目录下新建的会话生效，已开启的会话不受影响。
version: 1
# 要在这个项目里关闭的全局服务器（按 serverName）：
disableGlobal:
  - utools
servers:
  playwright:
    transport: stdio
    command: npx
    args: ["-y", "@playwright/mcp"]
  figma:
    url: https://mcp.figma.com/mcp   # 省略 transport：有 url 即 streamable-http
    headers:
      Authorization: "Bearer ..."
  scratch:
    command: node
    args: ["./scratch-server.js"]
    disabled: true                   # 保留配置但不挂载（卡片上的「停用」）
```

语义：

| 情形 | 行为 |
|---|---|
| 项目有、全局没有 | 新增，只对该项目的会话可见 |
| 与全局同名 serverName | 项目覆盖全局（工具层 own 覆盖 inherited），**全局那份实例仍在后台运行**，只是工具被遮蔽 |
| 全局有、项目不想用 | 写进 `disableGlobal`，按 serverName 前缀 `mcp__<name>__` 调 `tools.restrict({deny})` |
| 项目条目写 `disabled: true` | 不挂载它，并把同名全局服务器的工具一并遮住——项目配置优先，「项目停用、全局启用」也表现为停用 |
| 全局停用、项目条目启用 | 项目自己挂一份实例，因此表现为启用 |
| 配置文件写错某条 | 该条跳过并在日志/界面报出原因，其余条目照常生效 |

界面上这套语义对应一张卡片：状态标签显示项目条目的启停，启停按钮只增删
`disabled: true`（配置本体一个字节都不动，重新启用能回到原样）；同一个
serverName 在全局也存在时，卡片会额外标出「覆盖全局」。

实现方式与 dsh 内部的 `browser-use-runtime` 相同：`agent/created` 时
`createScope(ctx, agent)` + `scope.ctx.plugin(McpClient, config)`，工具因此落在该
agent 的层里；会话销毁时 scope 一并释放，MCP 连接与子进程随之退出。挂载**不 await**，
一个连不上的项目服务器不会拖住会话创建（工具会在随后的 `tools/change` 里补上）。

注意事项：

- 配置**只在会话创建时读取一次**，改完要新开会话才生效；已开启的会话保持原样。
- 每个带项目服务器的会话都会起自己的 MCP 子进程，开很多会话时资源占用会上升。
- 项目配置可能含 token，落盘权限为 `0600`；提交进 git 前请自行确认，并考虑加
  `.gitignore`。
- 项目级依赖 dsh 的 `working-directory` 服务（`dsh-base` 自带）。没有它的组合里，
  项目级功能自动不生效，全局 MCP 管理不受影响。


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
| `@deepseek-ai/dsh-mcp-client` | `peerDependencies` | 同上；项目级挂载要复用宿主那份 `Config` 与 `apply` |
| `@deepseek-ai/dsh-scope` | `peerDependencies` | 同上；`createScope` 用来给每个会话开独立作用域 |

`dsh-atomic-write` / `dsh-mcp-client` / `dsh-scope` 声明为 peer 而非 dependency，
是让它们由宿主供给单一实例，插件仓库因此既不需要、也不应该携带 `node_modules`。
peer 声明还有一层实际作用：profile 的运行时解析拦截只把**声明为 peer** 的请求路由到
dsh 安装目录里的那份包，没声明时 `require` 会直接 `MODULE_NOT_FOUND`。

## 安装与启用

本插件是 dsh bundle，由 dsh 桌面版按 `package.json` 中的 `dsh` 字段识别并加载：

- `dsh.bundle.patch` 指向 `cordis.patch.yml`，由 Host 半作为一条 Loader 行注册。
- `dsh.client` 声明 `platform: web` 与 inject 目标，由 dsh 客户端模块系统把
  `lib/client.js` 作为浏览器半侧送出。

通过 dsh 插件管理器或 `dsh plugin --profile <profile> add <本仓库地址>` 安装：pnpm 会按
`dependencies` 自动装上 `yaml`（peer 由宿主供给，pnpm 不装）。加载后入口出现在**「设置」页
的侧边列表**里，名为「MCP 服务器」（本插件注册的是 `settings.section` 槽位，不在主界面左侧
导航）。

> 本地开发若用 `link:` 挂载源码目录，pnpm 不会安装本插件的 `dependencies`；此时需在插件
> 目录内执行一次 `pnpm install` 得到本地 `node_modules`（已 gitignore），解析时插件自身
> 的 `node_modules` 优先级最高。用 `github:` / tarball 地址安装则依赖自动装进 profile，
> 无需此步。

## 能力边界

- 支持 `stdio` 与 `streamable-http` 两种传输方式的查看、编辑与新增。
- 新增：列表页右上角「新增服务器」→ 填表单（可写一段说明注释，留空则自动生成
  时间注释）→ 保存即在 `cordis.patch.yml` 末尾追加一个 `- insert:` 块，无需手工
  编辑文件。注释只在新建时写入，改写既有行不会动它。
- 删除：删除前回报「会一并删掉的注释行数」供确认，并把原文备份到同目录 `.bak`。
- 写入只改目标行（就地逐键合并），注释、缩进、折行与 `!!js` 表达式保持原样。
- 项目级：卡片是主视图，每条服务器可新增、编辑、启用/停用、删除；写作用 YAML
  Document API 就地改一个条目，注释、缩进与顺序保留，删除前把原文备份到同目录；
  卡片操作以源码编辑器的当前文本为基底，未保存的源码改动不会被冲掉。
  页面最下方的「源码」区默认折叠，用于手改注释、`disableGlobal` 或整份文本，
  也仍支持把 `.mcp.json` 片段转换后合并进去。
- 项目级不做「运行中会话热切换」：会话中途切目录不会重新挂载，配置改动也只在
  新会话生效（包括启停）。

## 许可证

[MIT](./LICENSE)

/**
 * dsh-mcp-manager 的 Host 半侧。
 *
 * 职责：为浏览器半侧提供一条受认证的读写通道，让它能查看并编辑本 profile 里
 * 的 MCP 服务器行（`@deepseek-ai/dsh-mcp-client` 的 Loader 行）。
 *
 * 为什么必须由 Host 半来做（而不是直接用现成的 Remote）：
 *   - mcp-client 的 Config 是顶层 `z.union` 且没有任何 `.volatile()` 字段，
 *     `dsh-settings` 的 `volatileForm()` 对 union 直接返回 undefined，于是
 *     `settings.describe()` 把这些行整条过滤掉，`settings.mutate` 也会以
 *     "has no volatile fields" 硬拒绝。现成的设置表单一无所知。
 *   - `configEditor.edit()` 虽然能写完整 raw config，但它只能定位 **顶层** 行；
 *     本 profile 的 MCP 行都来自 `- insert:` 块，`configEditor` 不会修改 insert
 *     块，而是往文件末尾追加一条同 id 的顶层 override 行。那会让同一个 MCP 出现
 *     两处配置来源，并且此后手改 insert 块的值不再生效（被顶层行遮蔽）——对以
 *     insert 为主要编辑位置的用户是陷阱。
 *
 * 写入策略：直接保真改写 `- insert:` 块内那一行的 config。用 yaml 的 Document API
 * 就地改节点，因此注释、缩进、折行与 `!!js` 表达式全部原样保留（已实测：只差目标
 * 那一行）。配套使用 dsh 自己的原子写与文件锁，与官方编辑器的落盘方式一致。
 *
 * 传输选型：用 `ctx.connection.rpc.handle()`，而不是自建 typert Remote。
 * 前者是通用认证 RPC 通道（官方 `dsh-client-file-upload` 亦经 connection 面），
 * Host/Origin 校验与浏览器认证由 Connection 的 `admit()` 完成（401/403），
 * 且不需要任何 typert 描述符或生成的严格 codec —— 手写 bundle 没有构建链，
 * 这一点是决定性的。
 *
 * 能力边界：本阶段只做「读 + 改已存在的行」。增删行属于后续阶段。
 *
 * 项目级 MCP（同一份文件的下一节）：
 *   - 项目 = 会话 cwd 所在的那个仓库。项目根沿用 `.git` 向上查找，与 `.dsh/skills`
 *     的判定完全一致（skill-filesystem 的 findProjectRoot）：找不到 `.git` 就是 cwd 自己。
 *   - 每个项目在自己的 `<项目根>/.dsh/mcp.yml` 里声明服务器，格式直接复用
 *     mcp-client 的 Config 字段，因此不需要第二套 schema。
 *   - 会话创建时（`agent/created`）把 mcp-client 实例挂进该 agent 的 scope
 *     （`createScope` + `scope.ctx.plugin`），工具于是只对这个会话可见，
 *     会话销毁时 scope 一起回收，子进程随之退出。
 *   - 与 profile 级的关系是「增量 + 覆盖」：同名 serverName 由项目覆盖
 *     （工具层 own 覆盖 inherited，天然成立）；全局有而项目不想用的，用
 *     `disableGlobal` 按 serverName 调 `tools.restrict({deny})` 关掉。
 *   - 项目条目可以写 `disabled: true` 单独停用。这是本插件自己的标记（不属于
 *     mcp-client 的 Config），解析时摘掉、挂载时跳过；同时把它按 serverName
 *     并进 deny 前缀，于是「项目停用、全局启用」也表现为停用——项目优先。
 *
 * 项目级的写通路与全局不同：`project/save` 整份文本落盘（源码编辑器），
 * `project/update` / `project/remove` / `project/toggle` 则用 YAML Document API
 * 就地改一个条目，同样保留注释与缩进，并在删除前备份原文。
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

// 依赖归属（见 package.json）：yaml 是第三方库走 dependencies，由 pnpm 安装；
// 其余在宿主运行时闭包内，声明为 peer 由宿主供给单一实例，
// 因此插件仓库不携带 node_modules，也不应自带副本。
const require = createRequire(import.meta.url);
const yaml = require("yaml");
const { withFileLock, writeFileAtomic } = require("@deepseek-ai/dsh-atomic-write");
// 这两个包必须出现在 peerDependencies 里，否则 profile 的解析拦截不会把
// 请求路由到 dsh 安装目录中的同一份副本（裸 Node 复现不到，只能实测）。
// McpClient 是 Cordis 插件：`Config(input)` 规范化配置，`plugin(McpClient, config)` 挂载。
const { createScope } = require("@deepseek-ai/dsh-scope");
const McpClient = require("@deepseek-ai/dsh-mcp-client");

export const name = "dsh-mcp-manager";

/** MCP 客户端包名：用于筛出目标行。 */
const MCP_MODULE = "@deepseek-ai/dsh-mcp-client";

/**
 * 必需服务。
 *
 * `configEditor` 用于读取当前配置与定位条目；`profileContext` 提供 profile
 * patch 的写入路径；`tools` 用于投影 `mcp__<serverName>__*` 工具清单。
 */
export const inject = ["connection", "configEditor", "profileContext", "tools"];

/**
 * 本插件在浏览器 `/api` 通道下的 exact Fetch 路由。
 *
 * 为什么用 `connection.fetch.register` 而不是 `connection.rpc.handle`：
 * 后者内部会 `owner.effect(() => owner.webServer.register(route))`，而 Cordis 会把
 * 这个 `owner` 换成**调用方的 shadow 上下文**（`createShadowMethod` →
 * `ctx.extend({[symbols.shadow]: …})`）；该 fiber 既无 runtime 也不带 inject，
 * 因此无论本插件声明多少 inject，都会抛
 * `cannot get property "webServer" without inject`（已实测）。
 *
 * `fetch.register` 只做 `owner.effect` 与写自己的路由表，完全不碰 `webServer`
 * —— 官方 `dsh-client-file-upload` 用的就是这条路径。路由必须落在 `/api` 之下，
 * 这样由 connection 已注册的 `/api` 前缀路由代管认证（`admit()` → 401/403）。
 */
const API_ROUTE = "/api/mcp-config";

/** 把值深拷贝成 JSON 安全的普通数据（patch 里可能出现 `{__jsExpr}` 包装）。 */
function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
}

/** fiber 状态数字 → 稳定名字，与 Host 清单使用的词汇保持一致。 */
function phaseOf(entry) {
    switch (entry?.fiber?.state) {
        case 0: return "pending";
        case 1: return "loading";
        case 2: return "active";
        case 3: return "failed";
        case 4: return null;
        case 5: return "unloading";
        default: return null;
    }
}

/** 构造结构化失败，让客户端能区分「业务拒绝」与「传输故障」。 */
function failure(code, message, details) {
    return { ok: false, error: { code, message, details: details ?? {} } };
}

/** 校验 serverName：与 mcp-client 的 SERVER_NAME_PATTERN 保持一致。 */
function validServerName(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value);
}

/**
 * 校验 profile patch 行 id。
 *
 * 沿用与 serverName 相同的 `^[A-Za-z0-9_-]{1,32}$`：这是所有现有行 id 都已验证可用的
 * 字符集，不另发明更宽松的规则。它天然排除了 `:`——界面启停用的树限定 id 是
 * `include:<id>`，id 里出现冒号会让那个 id 产生歧义。
 * @param value - 待校验的 id。
 * @returns 是否合规。
 */
function validPatchId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(value);
}

/**
 * 当前所有活 Loader 项的 id。
 *
 * 用于判断新行 id 是否已被别的项占用。注意重复 id 的后果不是「报个错」那么温和：
 * `configEditor` 只保留恰好出现一次的 id，其余行会变成不可寻址（界面上表现为
 * `readOnlyReason: "unaddressable"`）。
 * @param ctx - Host 插件上下文。
 * @returns id 集合。
 */
function liveIds(ctx) {
    const ids = new Set();
    for (const entry of ctx.configEditor.entries()) {
        if (typeof entry.options?.id === "string") ids.add(entry.options.id);
    }
    return ids;
}

/**
 * 校验一份待写入配置的形状。
 *
 * 这里只做早期拒绝，让用户拿到可读原因；权威校验仍由 Loader 的
 * `resolveConfig(Config)` 在重载该行时完成，因此不会出现「本地放行、Host 才拒绝」
 * 之外的语义偏差。
 * @param config - 客户端提交的完整配置对象。
 * @returns 错误消息；undefined 表示通过。
 */
function validateConfig(config) {
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
        return "config must be an object";
    }
    if (config.transport !== "stdio" && config.transport !== "streamable-http") {
        return 'transport must be "stdio" or "streamable-http"';
    }
    if (!validServerName(config.serverName)) {
        return "serverName must match ^[A-Za-z0-9_-]{1,32}$";
    }
    if (config.transport === "stdio") {
        if (typeof config.command !== "string" || config.command.length === 0) {
            return "command is required for the stdio transport";
        }
    } else {
        if (typeof config.url !== "string" || config.url.length === 0) {
            return "url is required for the streamable-http transport";
        }
        try {
            new URL(config.url);
        } catch {
            return `url is not a valid absolute URL: ${String(config.url)}`;
        }
    }
    if (config.toolCallTimeoutMs !== undefined) {
        const value = config.toolCallTimeoutMs;
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
            return "toolCallTimeoutMs must be a positive number";
        }
    }
    return undefined;
}

/** 目标摘要：stdio 显示 command + args，http 显示 url。 */
function targetOf(config) {
    if (config.transport === "stdio") {
        const args = Array.isArray(config.args) ? config.args.join(" ") : "";
        const command = String(config.command ?? "");
        return args.length === 0 ? command : `${command} ${args}`;
    }
    return String(config.url ?? "");
}

/**
 * 读取当前 profile 里所有 MCP 行。
 *
 * 同时返回两个身份，因为它们服务于不同的写入通路，不能混用：
 *   - `entryId`：Loader 树里的限定 id（形如 `include:mcp-codegraph`），
 *     供 `remote.pluginManager.setPluginEnabled` 使用；
 *   - `patchId`：profile patch 里的行 id（形如 `mcp-codegraph`），
 *     供写入定位使用，也是界面上展示的名字。
 * 工具清单只回传数量：`mcp__*__*` 的工具可能很多，把名字全部过线没有必要。
 */
function readRows(ctx) {
    const schemas = ctx.tools.schemas();
    const rows = [];
    for (const item of ctx.configEditor.configuration()) {
        const entry = item.entry;
        if (entry.options.name !== MCP_MODULE) continue;
        const config = clone(entry.options.config ?? {});
        const serverName = typeof config.serverName === "string" ? config.serverName : undefined;
        const prefix = serverName === undefined ? undefined : `mcp__${serverName}__`;
        rows.push({
            entryId: entry.id,
            patchId: entry.options.id,
            moduleName: MCP_MODULE,
            serverName,
            transport: config.transport,
            target: targetOf(config),
            enabled: entry.disabled !== true,
            phase: phaseOf(entry),
            config,
            toolCount: prefix === undefined ? 0 : schemas.filter((tool) => typeof tool?.name === "string" && tool.name.startsWith(prefix)).length
        });
    }
    return rows;
}

/** 按 profile patch 行 id 查一条 MCP 行；找不到返回 undefined。 */
function findRow(ctx, patchId) {
    return ctx.configEditor.configuration().find(
        (item) => item.entry.options.id === patchId && item.entry.options.name === MCP_MODULE
    );
}

/**
 * 等运行时配置收敛到刚写入的值。
 *
 * 本插件是直接改写 profile patch 文件（为了保住手工维护的注释与格式），重载由
 * 文件监听异步触发，因此写完立刻读活配置往往还是旧值。若不确认就报「已热生效」，
 * 界面会拿着旧值继续显示，让人以为保存失败。
 *
 * 只比较**本次真正改动过的键**：未改动的键可能被 schema 归一化（默认值、null 等），
 * 拿来比较会把正常重载误判成未收敛。
 *
 * @param ctx - Host 插件上下文。
 * @param patchId - profile patch 行 id。
 * @param expected - 刚写入的完整配置。
 * @param previous - 写入前的配置，用于筛出改动的键。
 * @param timeoutMs - 最长等待时间。
 * @returns 运行时配置是否已反映本次写入。
 */
async function waitApplied(ctx, patchId, expected, previous, timeoutMs = 2000) {
    const keys = Object.keys(expected).filter(
        (key) => JSON.stringify(expected[key]) !== JSON.stringify(previous[key])
    );
    if (keys.length === 0) return true;

    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const row = readRows(ctx).find((item) => item.patchId === patchId);
        if (row !== undefined
            && keys.every((key) => JSON.stringify(row.config[key]) === JSON.stringify(expected[key]))) {
            return true;
        }
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

/**
 * 等一条行从运行时配置里消失。
 *
 * 与 `waitApplied` 同一个理由：删除同样是「写文件 + 由文件监听异步重载」，不确认就
 * 立刻读活配置，会把**已被删掉的行**继续读回来，界面于是显示一行不存在的服务器，
 * 用户再点一次删除就会拿到 `unknown-row`。
 * @param ctx - Host 插件上下文。
 * @param patchId - 已删除的行 id。
 * @param timeoutMs - 最长等待时间。
 * @returns 运行时是否已不再包含该行。
 */
async function waitGone(ctx, patchId, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (findRow(ctx, patchId) === undefined) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

/**
 * 把一个 YAML 节点就地合并成目标值，**只替换真正变化的子树**。
 *
 * 为什么不能直接用 `node.set(key, document.createNode(value))` 整体替换：那会把
 * 整个 subtree 重新序列化，丢失原有的引号风格、折行与 `!!js` 标签（实测会让
 * config 段多行外观改变）。逐键比较后只改动值确实不同的节点，未变的节点原样保留，
 * 因此最终文件只差用户实际修改的那一处。
 *
 * @param document - 承载新节点的 YAML Document（提供 createNode）。
 * @param node - 现有的 YAML 节点。
 * @param value - 期望的普通 JS 值。
 * @returns 是否要求调用方整体替换该节点（true 表示无法就地合并）。
 */
function mergeInto(document, node, value) {
    const plain = yaml.isNode(node) ? node.toJSON() : node;
    // 标量、数组与 null：值相同则保留原节点，否则由调用方整体替换。
    if (!yaml.isMap(node) || value === null || typeof value !== "object" || Array.isArray(value)) {
        return JSON.stringify(plain) === JSON.stringify(value) ? false : true;
    }

    // 映射：删掉多余的键，其余逐键递归。
    const wanted = new Set(Object.keys(value));
    for (const pair of [...node.items]) {
        const key = String(pair.key?.value ?? pair.key);
        if (!wanted.has(key)) node.delete(key);
    }
    for (const [key, child] of Object.entries(value)) {
        const existing = node.get(key);
        if (existing === undefined) {
            node.set(key, document.createNode(child));
            continue;
        }
        if (mergeInto(document, existing, child)) node.set(key, document.createNode(child));
    }
    return false;
}

/**
 * 在 profile patch 上做一次「读 - 改 - 原子写」。
 *
 * 为什么要自己写而不是调用 `configEditor.edit()`：见文件头说明。保真手段是
 * `parseDocument` + 就地逐键合并 + `String(document)`，因此注释、缩进、引号风格、
 * 折行与 `!!js` 表达式全部原样保留；落盘走 `writeFileAtomic`，并锁 profile 的
 * `package.json`（与 config-editor / plugin-manager 同一把锁，避免与设置写入或
 * 插件启停并发互相覆盖）。
 *
 * @param ctx - 携带 profileContext 的插件上下文。
 * @param mutate - 就地修改已解析的 YAML Document；返回 `{changed, value}`。
 *   `changed` 不为 true 时不落盘，因此无改动的保存不产生任何字节变化。
 * @returns `mutate` 返回的 `value`。
 */
async function withPatchDocument(ctx, mutate) {
    const profile = ctx.profileContext;
    const filename = profile.patchPath;
    let value;

    await withFileLock(join(profile.dir, "package.json"), async () => {
        let text;
        try {
            text = await readFile(filename, "utf8");
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            text = "[]\n";
        }

        const document = yaml.parseDocument(text, {
            customTags: [{ tag: "tag:yaml.org,2002:js", resolve: (value) => value }]
        });
        if (document.errors[0] !== undefined) throw document.errors[0];
        if (!yaml.isSeq(document.contents)) throw new Error("Profile patch must be a YAML sequence");
        document.contents.flow = false;

        const outcome = await mutate(document, text);
        if (outcome.changed === true) await writeFileAtomic(filename, String(document), { mode: 0o600 });
        value = outcome.value;
    });

    return value;
}

/**
 * 收集 `- insert:` 块里的所有行，并带上删除所需的定位信息。
 * @param document - profile patch 文档。
 * @returns 每项为 `{id, row, list, index, block}`；`block` 是该 insert 块的顶层节点。
 */
function insertRows(document) {
    const found = [];
    for (const block of document.contents.items) {
        if (!yaml.isMap(block) || !block.has("insert")) continue;
        const list = block.get("insert");
        if (!yaml.isSeq(list)) continue;
        for (const [index, row] of list.items.entries()) {
            if (yaml.isMap(row)) found.push({ id: row.get("id"), row, list, index, block });
        }
    }
    return found;
}

/**
 * 判断 id 是否已被别的行占用。
 *
 * 只把「定义插件」的行算作占用：insert 块里的行，以及带 `name` 的顶层行（例如
 * `mcp-manager` 自己、`9router-web-search`）。
 *
 * 纯 `disabled` 的顶层行**不算**占用：那正是 pluginManager 为同一个 id 写的覆盖行，
 * 是预期的联接关系。但顶层同 id 且带 `config` 的行要算占用——`configEditor` 会让它
 * 遮蔽 insert 块里的配置，本插件「insert 块是唯一真相源」的约定会被破坏。
 *
 * @param document - profile patch 文档。
 * @param patchId - 待检查的 id。
 * @returns 冲突说明；未冲突返回 undefined。
 */
function conflictOf(document, patchId) {
    for (const block of document.contents.items) {
        if (!yaml.isMap(block) || block.has("insert")) continue;
        if (block.get("id") !== patchId) continue;
        if (block.has("config")) {
            return `a top-level row with id ${JSON.stringify(patchId)} carries its own config and would shadow the insert block`;
        }
        if (block.has("name")) {
            return `a top-level row with id ${JSON.stringify(patchId)} already defines a plugin`;
        }
    }
    return undefined;
}

/** 备份文件名用的时间戳，与既有 `.bak-*` 命名风格一致。 */
function stamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 注释上限：够写清用途，又不至于把 patch 写成一篇文档。 */
const COMMENT_MAX_LINES = 20;
const COMMENT_MAX_CHARS = 1000;

/**
 * 规范化用户填写的注释。
 *
 * yaml 的 `commentBefore` 是「每个换行再补一个 `#`」的纯字符串，所以每行都要自带
 * 前导空格，否则会序列化成 `#文本`（缺空格）；空行原样保留，用作分段。
 * @param value - 用户输入的多行文本。
 * @returns 可直接赋给 `commentBefore` 的字符串；全是空行时返回 undefined。
 */
function normalizeComment(value) {
    const lines = value.split(/\r?\n/).map((line) => line.trim());
    while (lines.length > 0 && lines[0] === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (lines.length === 0) return undefined;
    return lines.map((line) => (line.length === 0 ? "" : ` ${line}`)).join("\n");
}

/**
 * 删除一条 MCP 行。
 *
 * 这些 insert 块上方通常有手工维护的说明注释，删行时不能静默销毁：调用方会拿到
 * 一起被删掉的注释行数用于确认，且删除前先把**原始全文**备份到同目录，保证可回滚。
 *
 * @param ctx - 携带 profileContext 的插件上下文。
 * @param patchId - 要删除的行 id。
 * @returns `{comments, backupPath}`；行不存在时返回 `{missing}`。
 */
async function removeRowConfig(ctx, patchId, confirm) {
    const profile = ctx.profileContext;
    const filename = profile.patchPath;
    let comments = 0;
    let backupPath = "";

    const missing = await withPatchDocument(ctx, async (document, text) => {
        const target = insertRows(document).find((row) => row.id === patchId);
        if (target === undefined) {
            return { changed: false, value: `no "- insert:" row with id ${JSON.stringify(patchId)}` };
        }

        const comment = target.block.commentBefore;
        if (typeof comment === "string" && comment.length > 0) comments = comment.split("\n").length;
        // 预检：只回报「会一起删掉几行注释」，不改文件，让界面先拿给用户确认。
        if (confirm !== true) return { changed: false, value: undefined };

        backupPath = `${filename}.bak-${stamp()}-before-${patchId}-delete`;
        await writeFileAtomic(backupPath, text, { mode: 0o600 });

        if (target.list.items.length > 1) {
            // 同一块里还有别的行：只摘掉这一行，块与其注释都保留。
            target.list.delete(target.index);
        } else {
            // 整块只服务这一行：连块一起删，其带注释的文档随块消失。
            document.contents.delete(document.contents.items.indexOf(target.block));
        }
        return { changed: true, value: undefined };
    });

    if (missing !== undefined) return { missing };
    return { comments, backupPath };
}

//#region 项目级配置
/** 项目配置相对项目根的路径。 */
const PROJECT_CONFIG_PATH = join(".dsh", "mcp.yml");

/**
 * 文件不存在时给出的骨架。
 *
 * 字段说明写进文件本身：项目配置是纯文本编辑，用户需要能就地查到
 * 「transport 能不能省」「disableGlobal 写在哪」这些问题的答案。
 * `servers:` 后面刻意留空（不写 `{}`）：flow 风格的空映射会让后续合并
 * 序列化成 `{ playwright: {...} }` 这种难读的折行。
 */
const PROJECT_TEMPLATE = `# 项目级 MCP 服务器：只对本目录下新建的会话生效，已开启的会话不受影响。
# 与 profile 级同名的 serverName 会覆盖全局那一份（项目优先）。
# transport 可省略：有 command 即 stdio，有 url 即 streamable-http。
version: 1
# 要在这个项目里关闭的全局服务器（按 serverName）：
# disableGlobal:
#   - utools
servers:
`;

/** 与写 profile patch 时同一套自定义标签，保证 `!!js` 表达式能被解析。 */
const CUSTOM_TAGS = [{ tag: "tag:yaml.org,2002:js", resolve: (value) => value }];

/**
 * 存在性判断。
 *
 * 「不存在」是这里最常见的答案（往上找 `.git` 时每个目录都要问一次），
 * 因此任何 stat 失败都按不存在处理，与 skill-filesystem 的 pathExists 同口径。
 * @param path - 待检查的绝对路径。
 * @returns 是否存在。
 */
async function exists(path) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * 找项目根：从 cwd 向上找第一个含 `.git` 的目录。
 *
 * 与 `.dsh/skills` 的项目根判定一致（skill-filesystem 的 findProjectRoot），
 * 因此「项目」在 DSH 里只有一个含义：会话 cwd 所在的那个仓库。
 * 找不到 `.git` 时回落到 cwd 本身，这样无 git 的目录也能用项目级配置。
 * @param cwd - 会话工作目录。
 * @returns 项目根绝对路径。
 */
async function findProjectRoot(cwd) {
    const start = resolve(cwd);
    let current = start;
    for (;;) {
        if (await exists(join(current, ".git"))) return current;
        const parent = dirname(current);
        if (parent === current) return start;
        current = parent;
    }
}

/**
 * 规范化一条项目服务器配置。
 *
 * 权威校验交给 mcp-client 自己的 `Config`：界面报错与运行时拒绝的原因因此永远
 * 是同一句话，不会出现「界面放行、挂载才失败」。顺带拿到补全默认值后的配置。
 *
 * `disabled` 是本插件的启停标记，不是 mcp-client 的字段：先摘出来再交给 `Config`，
 * 免得它混进归一化结果后被当成未知键写回文件。同时回传摘掉标记后的原始形状，
 * 供界面编辑表单预填——用归一化结果预填会把默认值（args: [] 等）实体化。
 * @param serverName - `servers` 映射里的键。
 * @param raw - 该键对应的原始值。
 * @returns `{serverName, config, raw, disabled}` 或 `{problem}`。
 */
function normalizeServerEntry(serverName, raw) {
    if (!validServerName(serverName)) {
        return { problem: `serverName ${JSON.stringify(serverName)} 需匹配 ^[A-Za-z0-9_-]{1,32}$` };
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return { problem: `servers.${serverName} 必须是映射` };
    }
    const { disabled, ...rest } = raw;
    // 界面只认布尔值：`disabled: yes` 这种写法在 YAML 1.2 里是字符串，
    // 静默当成启用会让人以为停用没生效，不如直接报出来。
    if (disabled !== undefined && disabled !== null && typeof disabled !== "boolean") {
        return { problem: `servers.${serverName}.disabled 必须是布尔值` };
    }
    const input = { ...rest, serverName };
    // 省略 transport 时按字段推断，与 JSON 导入的规则一致。
    if (input.transport === undefined) {
        if (typeof input.command === "string") input.transport = "stdio";
        else if (typeof input.url === "string") input.transport = "streamable-http";
    }
    try {
        return { serverName, config: McpClient.Config(input), raw: rest, disabled: disabled === true };
    } catch (error) {
        return { problem: `servers.${serverName}: ${String(error?.message ?? error)}` };
    }
}

/**
 * 解析项目配置文本。
 *
 * 不抛异常：条目写错是用户常态，交给调用方决定口径——运行时只记日志跳过，
 * 界面把 problems 原样展示。有效条目照常返回，一条写错不会拖垮整个项目。
 * @param text - 文件内容。
 * @returns `{servers, disableGlobal, problems}`。
 */
function parseProjectConfig(text) {
    const servers = [];
    const disableGlobal = [];
    const problems = [];
    let document;
    try {
        document = yaml.parseDocument(text, { customTags: CUSTOM_TAGS });
        if (document.errors.length > 0) throw document.errors[0];
    } catch (error) {
        return { servers, disableGlobal, problems: [`YAML 解析失败：${String(error?.message ?? error)}`] };
    }

    const data = document.toJSON();
    if (data !== null && (typeof data !== "object" || Array.isArray(data))) {
        return { servers, disableGlobal, problems: ["配置根必须是一个映射"] };
    }

    const rawServers = data?.servers;
    if (rawServers !== undefined && rawServers !== null) {
        if (typeof rawServers !== "object" || Array.isArray(rawServers)) {
            problems.push("servers 必须是映射（serverName → 配置）");
        } else {
            for (const [serverName, raw] of Object.entries(rawServers)) {
                const entry = normalizeServerEntry(serverName, raw);
                if (entry.problem !== undefined) problems.push(entry.problem);
                else servers.push(entry);
            }
        }
    }

    const rawDisable = data?.disableGlobal;
    if (rawDisable !== undefined && rawDisable !== null) {
        if (!Array.isArray(rawDisable)) {
            problems.push("disableGlobal 必须是数组");
        } else {
            for (const name of rawDisable) {
                if (validServerName(name)) disableGlobal.push(name);
                else problems.push(`disableGlobal 里的 ${JSON.stringify(name)} 需匹配 ^[A-Za-z0-9_-]{1,32}$`);
            }
        }
    }

    return { servers, disableGlobal, problems };
}

/**
 * 读取某个工作目录的项目配置；文件缺失时返回骨架文本（`exists: false`）。
 * @param cwd - 会话工作目录。
 * @returns `{root, filename, exists, text, servers, disableGlobal, problems}`。
 */
async function readProjectConfig(cwd) {
    const root = await findProjectRoot(cwd);
    const filename = join(root, PROJECT_CONFIG_PATH);
    let text;
    try {
        text = await readFile(filename, "utf8");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return { root, filename, exists: false, text: PROJECT_TEMPLATE, ...parseProjectConfig(PROJECT_TEMPLATE) };
    }
    return { root, filename, exists: true, text, ...parseProjectConfig(text) };
}

/** 面向界面的投影：卡片只需要摘要，编辑表单要能预填，因此带上原始配置。 */
function projectView(project) {
    return {
        root: project.root,
        filename: project.filename,
        exists: project.exists,
        text: project.text,
        servers: project.servers.map((entry) => ({
            serverName: entry.serverName,
            enabled: entry.disabled !== true,
            transport: entry.config.transport,
            target: targetOf(entry.config),
            // 用文件里的原始形状而不是归一化结果：归一化会补出一堆默认值
            // （args: []、cwd: ""、timeout 60000 等），拿它预填再保存会把文件写胖。
            // transport 显式补上，免得省略 transport 的条目被表单误判成 http。
            config: { ...entry.raw, transport: entry.config.transport }
        })),
        disableGlobal: project.disableGlobal,
        problems: project.problems
    };
}

/**
 * 空节点判断。
 *
 * 模板里 `servers:` 后面什么都不写，解析出来是 null 标量——这种节点可以安全地
 * 换成映射。而 `servers: oops` 这类有值却不是映射的节点必须报错，否则会静默
 * 丢掉用户写下的内容。
 * @param node - YAML 节点。
 * @returns 是否是 null / undefined 标量。
 */
function isBlankNode(node) {
    if (node === null || node === undefined) return true;
    return yaml.isScalar(node) && (node.value === null || node.value === undefined);
}

/**
 * 取出 `servers:` 映射，必要时创建。
 *
 * `servers:` 留空时节点是 null 标量，必须先换成映射才能写入；已经是映射的则把
 * flow 风格归正，否则新增项会挤成一行。
 * @param document - 项目配置文档。
 * @returns `servers` 的 YAMLMap 节点。
 */
function ensureServersMap(document) {
    let current = document.getIn(["servers"], true);
    if (!yaml.isMap(current)) {
        document.setIn(["servers"], document.createNode({}));
        current = document.getIn(["servers"], true);
    }
    current.flow = false;
    return current;
}

/**
 * 把若干服务器合并进项目配置文本（**不落盘**），供「从 .mcp.json 导入」与
 * 「新增服务器」使用。
 *
 * 用 YAML Document 就地合并而不是重新序列化整个对象：既有条目的注释、引号
 * 风格与顺序都保留，只有被覆盖的条目本身变化。同名条目直接覆盖，因此返回
 * `overwritten` 让界面明说覆盖了谁。
 *
 * `baseText` 由界面传入编辑器当前正文：用户可能改了还没保存，若这里重新读磁盘，
 * 合并结果会把那些改动冲掉。没有传时才回退到文件内容。
 * @param cwd - 会话工作目录。
 * @param added - `serverName → 原始配置`（已通过 `normalizeServerEntry` 校验）。
 * @param baseText - 可选的合并基底；`undefined` 表示读取磁盘上的配置。
 * @returns `{root, filename, text, overwritten}`。
 */
async function mergeProjectServers(cwd, added, baseText) {
    const project = await readProjectConfig(cwd);
    const source = typeof baseText === "string" ? baseText : project.text;
    const document = yaml.parseDocument(source, { customTags: CUSTOM_TAGS });
    if (document.errors.length > 0) throw document.errors[0];
    if (document.contents === null) document.contents = document.createNode({});
    const current = ensureServersMap(document);

    // 覆盖对象取自合并基底而不是磁盘：编辑器里可能刚加过同名条目还没保存。
    const existing = new Set(current.items.map((pair) => String(pair.key?.value ?? pair.key)));
    const overwritten = Object.keys(added).filter((serverName) => existing.has(serverName));
    for (const [serverName, config] of Object.entries(added)) {
        applyServerEntry(document, current, serverName, config);
    }
    current.flow = false;

    return { root: project.root, filename: project.filename, text: String(document), overwritten };
}

/**
 * 就地把一个条目写进 `servers` 映射，只改真正变化的子树。
 *
 * 已有的 `disabled` 标记必须保留：启停由「停用」按钮单独管理，改写配置不能顺手
 * 把人停用的服务器又打开。`mergeInto` 会删掉新值里没有的键，所以标记要显式并回去。
 * @param document - 项目配置文档。
 * @param map - `servers` 的 YAMLMap 节点。
 * @param serverName - `servers` 映射里的键。
 * @param config - 待写入的配置（不含 `disabled`）。
 */
function applyServerEntry(document, map, serverName, config) {
    const next = { ...config };
    const existing = map.get(serverName, true);
    if (yaml.isMap(existing) && existing.get("disabled") === true) next.disabled = true;
    if (existing === undefined || mergeInto(document, existing, next)) {
        map.set(serverName, document.createNode(next));
    }
}

/**
 * 在项目配置上做一次「读 - 改 - 原子写」。
 *
 * `baseText` 是源码编辑器里的当前正文：卡片操作与源码编辑共用同一份文本，
 * 因此在源码里改了还没保存时，卡片操作不会把它冲掉（也不会另写一份旧内容）。
 * 缺省时读磁盘，文件不存在则从骨架开始。
 *
 * 这里不做整份配置的 schema 自检：条目本身已经过 `normalizeServerEntry` 校验，
 * 而 Document API 产出的 YAML 必然可解析。若拿 `parseProjectConfig` 全量卡一道，
 * 文件里一条与此无关的历史错误就会把卡片的所有操作都堵死。整份文本落盘的
 * `project/save` 仍保留严格校验——那才是用户手写内容的地方。
 * @param cwd - 会话工作目录（不必是项目根，内部自己向上找）。
 * @param options - `{text}`：可选的编辑基底。
 * @param mutate - 就地改 YAML Document；返回 `{changed, value, backupSuffix?}`。
 *   `changed` 不为 true 时不落盘，删除的预检分支因此不会产生任何字节变化。
 * @returns mutate 的 `value` 加上 `{root, filename, text, written}`。
 */
async function writeProjectDocument(cwd, options, mutate) {
    const root = await findProjectRoot(cwd);
    const filename = join(root, PROJECT_CONFIG_PATH);
    await mkdir(dirname(filename), { recursive: true });

    return await withFileLock(filename, async () => {
        let source = options.text;
        if (typeof source !== "string") {
            try {
                source = await readFile(filename, "utf8");
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
                source = PROJECT_TEMPLATE;
            }
        }

        const document = yaml.parseDocument(source, { customTags: CUSTOM_TAGS });
        if (document.errors.length > 0) throw document.errors[0];
        if (document.contents === null) document.contents = document.createNode({});

        const outcome = await mutate(document, source);
        if (outcome.changed !== true) {
            return { root, filename, written: false, text: source, ...outcome.value };
        }

        const text = String(document);
        // 删除会带走注释：先把原文备份到同目录，保证可回滚（与全局删除同口径）。
        let backupPath;
        if (typeof outcome.backupSuffix === "string") {
            backupPath = `${filename}.bak-${stamp()}-${outcome.backupSuffix}`;
            await writeFileAtomic(backupPath, source, { mode: 0o600 });
        }
        await writeFileAtomic(filename, text, { mode: 0o600 });
        return { root, filename, written: true, text, backupPath, ...outcome.value };
    });
}
//#endregion

//#region 运行时挂载
/**
 * 补做 disableGlobal 的 deny。
 *
 * 必须在两处调用：会话创建时先 deny 一次，之后每次 `tools/change` 再补一次。
 * 原因是全局 MCP 可能比会话晚连上（utools 这类要等本机服务起来），创建那一刻
 * 枚举不到它的工具，不补就会看到本该关掉的工具冒出来。
 * 只 deny 还没 deny 过的名字：restrict 会累积（交集），重复添加没有意义。
 * @param ctx - Host 插件上下文。
 * @param denials - 本插件实例的 agent → 禁用状态。
 * @param agent - 目标会话。
 */
function denyGlobalTools(ctx, denials, agent) {
    const state = denials.get(agent);
    if (state === undefined) return;
    const known = ctx.tools.schemas()
        .map((tool) => (typeof tool?.name === "string" ? tool.name : ""))
        .filter((name) => state.prefixes.some((prefix) => name.startsWith(prefix)));
    for (const name of known) {
        if (state.denied.has(name)) continue;
        try {
            state.scope.ctx.tools.restrict({ deny: [name] });
            state.denied.add(name);
        } catch (error) {
            // 工具可能在这一瞬间被别的实例注销（例如全局服务器重连），
            // 那就等下一次 tools/change 再补，不把会话创建带崩。
            ctx.logger.warn(`dsh-mcp-manager: 无法禁用全局工具 ${name}：${String(error?.message ?? error)}`);
        }
    }
}

/**
 * 在 agent 的 scope 里挂载项目服务器。
 *
 * 不 await 挂载结果：`mcp-client` 的 `apply()` 一定会 await 首次连接，
 * 在 `agent/created` 里等它就会让一个连不上的项目 MCP 卡住整个会话创建。
 * 代价是工具晚一两步入场——每个 step 都会重新 assemble，`toolsChange` 会让
 * 它自动生效，这与 ACP 之外的官方用法一致。
 *
 * 停用的条目（`disabled: true`）不挂载，但它的 serverName 要并进 deny 前缀：
 * 项目配置优先于全局，否则「项目停用、全局启用」会看到全局那份工具。
 * @param ctx - Host 插件上下文。
 * @param denials - 本插件实例的 agent → 禁用状态。
 * @param agent - 目标会话。
 * @param project - `readProjectConfig` 的结果。
 */
function mountProjectServers(ctx, denials, agent, project) {
    const enabled = project.servers.filter((entry) => entry.disabled !== true);
    const hidden = project.servers.filter((entry) => entry.disabled === true).map((entry) => entry.serverName);
    // 项目条目优先：`disableGlobal` 里同时写了某个 serverName 时，以项目自己的
    // 启用状态为准，否则会把刚挂上的项目实例又 deny 掉。
    const enabledNames = new Set(enabled.map((entry) => entry.serverName));
    const suppressed = [...project.disableGlobal, ...hidden].filter((name) => !enabledNames.has(name));
    if (enabled.length === 0 && suppressed.length === 0) return;

    const scope = createScope(ctx, agent);
    // scope 的 key 就是 agent，因此这里注册的工具只进这个 agent 的层；
    // 会话销毁时由 agent.ctx 的 effect 收尾，MCP 连接与子进程一并退出。
    agent.ctx.effect(() => async () => {
        denials.delete(agent);
        await scope.dispose();
    }, "dsh-mcp-manager: project scope");

    for (const entry of enabled) {
        const config = { ...entry.config };
        // stdio 子进程默认在项目根里跑：项目级 MCP 的路径、配置文件通常都相对它。
        if (config.transport === "stdio" && config.cwd === "") config.cwd = project.root;
        let fiber;
        try {
            fiber = scope.ctx.plugin(McpClient, config);
        } catch (error) {
            ctx.logger.warn(`dsh-mcp-manager: 项目 MCP「${entry.serverName}」挂载失败：${String(error?.message ?? error)}`);
            continue;
        }
        void fiber.await().catch((error) => {
            ctx.logger.warn(`dsh-mcp-manager: 项目 MCP「${entry.serverName}」未就绪：${String(error?.message ?? error)}`);
        });
    }

    if (suppressed.length > 0) {
        denials.set(agent, {
            scope,
            prefixes: suppressed.map((name) => `mcp__${name}__`),
            denied: new Set()
        });
        denyGlobalTools(ctx, denials, agent);
    }
}

/**
 * 会话创建时决定这个会话挂哪些项目服务器。
 *
 * 配置只在这里读一次：已开启的会话不因文件改动而变化，这正是「项目独占目录」
 * 假设下的合理语义（改完配置新开会话即可）。
 * @param ctx - Host 插件上下文。
 * @param denials - 本插件实例的 agent → 禁用状态。
 * @param agent - 刚创建（尚未被外部观察到）的会话。
 */
async function startProjectServers(ctx, denials, agent) {
    // 不写进 inject：缺这个服务的组合里，项目级功能自动不生效，而不是让整个插件
    // （连同全局 MCP 管理）因为一个可选能力而无法激活。
    const workingDirectory = ctx.get("workingDirectory");
    if (workingDirectory === undefined) return;

    let project;
    try {
        project = await readProjectConfig(workingDirectory.get(agent.session));
    } catch (error) {
        ctx.logger.warn(`dsh-mcp-manager: 读取项目 MCP 配置失败：${String(error?.message ?? error)}`);
        return;
    }
    if (project.problems.length > 0) {
        // 有问题的条目已经在上面的解析里被跳过，这里只是把原因留在日志里。
        ctx.logger.warn(`dsh-mcp-manager: ${project.filename} 有 ${project.problems.length} 处问题：${project.problems.join("；")}`);
    }
    if (project.servers.length === 0 && project.disableGlobal.length === 0) return;

    try {
        // 读文件是异步的：会话可能已经在这段时间里销毁了。
        agent.ctx.fiber.assertActive();
    } catch {
        return;
    }
    mountProjectServers(ctx, denials, agent, project);
}
//#endregion

/**
 * 注册 MCP 读写通道。
 * 认证由 Connection 的 `admit()` 负责，本函数不重复实现信任检查。
 * @param ctx - 已注入所需服务的插件上下文。
 */
export function apply(ctx) {
    /** 本插件实例的 agent → disableGlobal 状态；会话销毁时由 mountProjectServers 删除。 */
    const denials = new Map();

    // 项目级 MCP 只在会话创建时决定挂什么：配置读取与挂载都不阻塞 agent/created
    // （返回 void），连不上的服务器只影响它自己。
    ctx.on("agent/created", ({ agent }) => {
        void startProjectServers(ctx, denials, agent);
    });
    // 全局 MCP 可能比会话晚连上（utools 这类要等本机服务），每次工具表变化都给
    // 已有会话补一次 deny，否则本该关掉的工具会在几十秒后冒出来。
    ctx.on("tools/change", () => {
        for (const agent of [...denials.keys()]) denyGlobalTools(ctx, denials, agent);
    });

    const list = () => {
        try {
            return { ok: true, value: { rows: readRows(ctx) } };
        } catch (error) {
            return failure("mcp/list-failed", String(error?.message ?? error));
        }
    };

    /**
     * 写入一条 MCP 行：已存在就就地改写（保真），不存在则追加一个 `- insert:` 块。
     *
     * `payload.create` 显式声明意图，避免 id 打错时静默多出一行：更新要求行已存在，
     * 新建要求行不存在。`payload.id` 是 profile patch 行 id（与界面展示的名字一致）。
     *
     * `payload.comment` 只在新建时生效，写成该 insert 块上方的注释；留空则落回
     * 「由 MCP 管理器新增（时间）」的默认注释。改写既有行时忽略它：块注释属于整块，
     * 同块可能还有别的行，静默改写会连带影响它们。
     * @param payload - `{id, config, create, comment}`。
     * @returns 成功时回传 `{id, created, applied}`。
     */
    const save = async (payload) => {
        const id = payload?.id;
        const config = payload?.config;
        const create = payload?.create === true;
        const comment = payload?.comment;
        if (typeof id !== "string" || id.length === 0) {
            return failure("mcp/bad-request", "id is required");
        }
        if (!validPatchId(id)) {
            return failure("mcp/invalid-row-id", "id must match ^[A-Za-z0-9_-]{1,32}$", { id });
        }
        const reason = validateConfig(config);
        if (reason !== undefined) return failure("mcp/invalid-config", reason, { id });
        if (comment !== undefined && typeof comment !== "string") {
            return failure("mcp/invalid-comment", "comment must be a string", { id });
        }
        const commentText = comment === undefined ? undefined : normalizeComment(comment);
        if (commentText !== undefined) {
            if (commentText.split("\n").length > COMMENT_MAX_LINES) {
                return failure("mcp/invalid-comment", `comment must be at most ${COMMENT_MAX_LINES} lines`, { id });
            }
            if (commentText.length > COMMENT_MAX_CHARS) {
                return failure("mcp/invalid-comment", `comment must be at most ${COMMENT_MAX_CHARS} characters`, { id });
            }
        }

        const existing = findRow(ctx, id);
        if (create && existing !== undefined) {
            return failure("mcp/row-exists", `row ${JSON.stringify(id)} already exists`, { id });
        }
        if (!create && existing === undefined) {
            return failure("mcp/unknown-row", `no MCP row with id ${JSON.stringify(id)}`, { id });
        }
        if (create && liveIds(ctx).has(id)) {
            return failure("mcp/duplicate-row",
                `id ${JSON.stringify(id)} is already used by another live entry`, { id });
        }
        const before = create ? {} : clone(existing.entry.options.config ?? {});

        // serverName 在同一注册作用域内必须唯一，否则 mcp-client 激活即报错。
        const duplicate = readRows(ctx).find((row) => row.patchId !== id && row.serverName === config.serverName);
        if (duplicate !== undefined) {
            return failure("mcp/duplicate-server-name",
                `serverName ${JSON.stringify(config.serverName)} is already used by ${JSON.stringify(duplicate.patchId)}`,
                { id });
        }

        let created = false;
        try {
            const rejected = await withPatchDocument(ctx, async (document) => {
                const target = insertRows(document).find((row) => row.id === id);
                if (target === undefined) {
                    const conflict = conflictOf(document, id);
                    if (conflict !== undefined) {
                        return { changed: false, value: failure("mcp/duplicate-row", conflict, { id }) };
                    }
                    // 追到文件末尾：纯追加不触碰任何既有字节，注释与格式天然安全。
                    const block = document.createNode({ insert: [{ id, name: MCP_MODULE, config: clone(config) }] });
                    // 每行自带前导空格是为了序列化成 `# …` 而不是 `#…`（见 normalizeComment）。
                    block.commentBefore = commentText ?? ` 由 MCP 管理器新增（${stamp()}）`;
                    document.add(block);
                    created = true;
                    return { changed: true, value: undefined };
                }
                const current = target.row.get("config");
                if (current === undefined) {
                    target.row.set("config", document.createNode(clone(config)));
                } else if (mergeInto(document, current, clone(config))) {
                    target.row.set("config", document.createNode(clone(config)));
                }
                return { changed: true, value: undefined };
            });
            if (rejected !== undefined && rejected.ok === false) return rejected;
        } catch (error) {
            return failure("mcp/save-failed", String(error?.message ?? error), { id });
        }

        // 新建的行要等 Loader 挂上它，给更宽的收敛窗口。
        const applied = await waitApplied(ctx, id, config, before, create ? 4000 : 2000);
        return { ok: true, value: { id, created, applied } };
    };

    /**
     * 删除一条 MCP 行。
     *
     * 分两步：`confirm !== true` 时只回报「会一起删掉几行注释」，让界面先确认；
     * `confirm === true` 时才真正删除，并在删除前把**原始全文**备份到同目录。
     * @param payload - `{id, confirm}`。
     * @returns 成功时回传 `{id, comments, backupPath?}`。
     */
    const remove = async (payload) => {
        const id = payload?.id;
        const confirm = payload?.confirm === true;
        if (typeof id !== "string" || id.length === 0) {
            return failure("mcp/bad-request", "id is required");
        }
        if (findRow(ctx, id) === undefined) {
            return failure("mcp/unknown-row", `no MCP row with id ${JSON.stringify(id)}`, { id });
        }

        let outcome;
        try {
            outcome = await removeRowConfig(ctx, id, confirm);
        } catch (error) {
            return failure("mcp/remove-failed", String(error?.message ?? error), { id });
        }
        if (outcome.missing !== undefined) {
            return failure("mcp/unknown-row", outcome.missing, { id });
        }
        // 删除后同样要确认运行时真的不再包含该行，否则界面会继续显示这一行。
        const applied = confirm ? await waitGone(ctx, id) : true;
        return {
            ok: true,
            value: {
                id,
                comments: outcome.comments,
                ...confirm ? { backupPath: outcome.backupPath, applied } : { preview: true }
            }
        };
    };

    /**
     * 读取一个工作目录对应的项目配置（文件不存在时返回骨架文本）。
     * @param payload - `{cwd}`，工作区路径（不必是项目根，插件自己向上找）。
     * @returns 成功时回传 `projectView` 的结果。
     */
    const projectRead = async (payload) => {
        const cwd = payload?.cwd;
        if (typeof cwd !== "string" || cwd.length === 0) {
            return failure("project/bad-request", "cwd is required");
        }
        try {
            return { ok: true, value: projectView(await readProjectConfig(cwd)) };
        } catch (error) {
            return failure("project/read-failed", String(error?.message ?? error), { cwd });
        }
    };

    /**
     * 把编辑器的文本落盘到 `<项目根>/.dsh/mcp.yml`。
     *
     * 先解析再写：写进去的必须是插件自己能读回来的配置，否则用户会得到一个
     * 「界面显示成功、会话里却什么都没挂」的文件。空文本是合法的（清空配置）。
     * @param payload - `{cwd, text}`。
     * @returns 成功时回传写入后的 `projectView`。
     */
    const projectSave = async (payload) => {
        const cwd = payload?.cwd;
        const text = payload?.text;
        if (typeof cwd !== "string" || cwd.length === 0) {
            return failure("project/bad-request", "cwd is required");
        }
        if (typeof text !== "string") {
            return failure("project/bad-request", "text is required");
        }
        const parsed = parseProjectConfig(text);
        if (parsed.problems.length > 0) {
            return failure("project/invalid-config", parsed.problems[0], { problems: parsed.problems });
        }
        try {
            const root = await findProjectRoot(cwd);
            const filename = join(root, PROJECT_CONFIG_PATH);
            await mkdir(dirname(filename), { recursive: true });
            // 项目配置可能带 token（Authorization 头），按 0600 落盘，与 profile patch 一致。
            await writeFileAtomic(filename, text, { mode: 0o600 });
            return { ok: true, value: projectView(await readProjectConfig(root)) };
        } catch (error) {
            return failure("project/save-failed", String(error?.message ?? error), { cwd });
        }
    };

    /**
     * 把界面转换好的服务器合并进项目配置文本，返回预览（不落盘）。
     *
     * 转换（`.mcp.json` → 配置对象、表单草稿 → 配置对象）在浏览器半侧完成，
     * 这里只负责校验与合并，因此两边共用同一套 serverName/transport 规则，
     * 也不会在浏览器里塞一个 YAML 库。
     * @param payload - `{cwd, servers, text?}`，`servers` 为 `serverName → 配置`；
     *   `text` 是编辑器当前正文，缺省时以磁盘文件为基底。
     * @returns 成功时回传 `{root, filename, text, overwritten}`。
     */
    const projectMerge = async (payload) => {
        const cwd = payload?.cwd;
        const servers = payload?.servers;
        const text = payload?.text;
        if (typeof cwd !== "string" || cwd.length === 0) {
            return failure("project/bad-request", "cwd is required");
        }
        if (servers === null || typeof servers !== "object" || Array.isArray(servers)) {
            return failure("project/bad-request", "servers must be an object keyed by serverName");
        }
        if (text !== undefined && typeof text !== "string") {
            return failure("project/bad-request", "text must be a string when provided");
        }
        const problems = [];
        for (const [serverName, raw] of Object.entries(servers)) {
            const entry = normalizeServerEntry(serverName, raw);
            if (entry.problem !== undefined) problems.push(entry.problem);
        }
        if (problems.length > 0) {
            return failure("project/invalid-config", problems[0], { problems });
        }
        try {
            return { ok: true, value: await mergeProjectServers(cwd, servers, text) };
        } catch (error) {
            return failure("project/merge-failed", String(error?.message ?? error), { cwd });
        }
    };

    /**
     * 新增或改写项目里的一条服务器（卡片表单的落点）。
     *
     * 与 `project/merge` 的区别：这里**直接落盘**并回传新视图，因为卡片操作没有
     * 「再点一次保存」的第二步。`create` 显式声明意图，避免 serverName 打错时
     * 静默多出一条：新增要求不存在，改写要求已存在。
     * @param payload - `{cwd, text?, serverName, config, create}`。
     * @returns 成功时回传写入后的 `projectView`。
     */
    const projectUpdate = async (payload) => {
        const cwd = payload?.cwd;
        const serverName = payload?.serverName;
        const config = payload?.config;
        const text = payload?.text;
        const create = payload?.create === true;
        if (typeof cwd !== "string" || cwd.length === 0) {
            return failure("project/bad-request", "cwd is required");
        }
        if (!validServerName(serverName)) {
            return failure("project/bad-request", "serverName is invalid", { serverName });
        }
        if (config === null || typeof config !== "object" || Array.isArray(config)) {
            return failure("project/bad-request", "config must be an object");
        }
        if (text !== undefined && typeof text !== "string") {
            return failure("project/bad-request", "text must be a string when provided");
        }
        const entry = normalizeServerEntry(serverName, config);
        if (entry.problem !== undefined) {
            return failure("project/invalid-config", entry.problem, { problems: [entry.problem] });
        }

        let outcome;
        try {
            outcome = await writeProjectDocument(cwd, { text }, async (document) => {
                const servers = document.getIn(["servers"], true);
                // `servers:` 后面留空是模板的写法（null 标量），可以直接换成映射；
                // 但已经有内容却不是映射时不能静默覆盖，那是用户写错了。
                if (servers !== undefined && !yaml.isMap(servers) && !isBlankNode(servers)) {
                    return { changed: false, value: { badServers: true } };
                }
                const existing = yaml.isMap(servers) ? servers.get(serverName, true) : undefined;
                // 意图必须与文件现状一致：否则写错 serverName 会静默多出一条，
                // 或把一个不存在的名字当成改写。
                if (create && existing !== undefined) return { changed: false, value: { conflict: true } };
                if (!create && existing === undefined) return { changed: false, value: { missing: true } };
                applyServerEntry(document, ensureServersMap(document), serverName, entry.raw);
                return { changed: true, value: {} };
            });
        } catch (error) {
            return failure("project/update-failed", String(error?.message ?? error), { cwd });
        }
        if (outcome.badServers === true) {
            return failure("project/invalid-config", "servers 必须是映射（serverName → 配置）", { problems: ["servers 必须是映射（serverName → 配置）"] });
        }
        if (outcome.conflict === true) {
            return failure("project/server-exists", `servers.${serverName} already exists`, { serverName });
        }
        if (outcome.missing === true) {
            return failure("project/unknown-server", `no server named ${JSON.stringify(serverName)}`, { serverName });
        }
        return { ok: true, value: projectView(await readProjectConfig(outcome.root)) };
    };

    /**
     * 删除项目里的一条服务器。
     *
     * 与全局删除同口径：`confirm !== true` 时只回报「会一起删掉几行注释」让界面
     * 先确认；确认后先把原文备份到同目录，再就地删掉该条目。
     *
     * 注释归属有个坑：**第一条服务器上方**的注释被 YAML 解析器挂在 `servers`
     * 映射节点上（而不是第一个键上），所以删第一条时要单独把它清掉，否则那段
     * 注释会留在空映射上方变成孤儿。
     * @param payload - `{cwd, text?, serverName, confirm}`。
     * @returns 预览 `{serverName, comments, preview}`；确认后 `{serverName, comments, backupPath, view}`。
     */
    const projectRemove = async (payload) => {
        const cwd = payload?.cwd;
        const serverName = payload?.serverName;
        const text = payload?.text;
        const confirm = payload?.confirm === true;
        if (typeof cwd !== "string" || cwd.length === 0) {
            return failure("project/bad-request", "cwd is required");
        }
        if (!validServerName(serverName)) {
            return failure("project/bad-request", "serverName is invalid", { serverName });
        }
        if (text !== undefined && typeof text !== "string") {
            return failure("project/bad-request", "text must be a string when provided");
        }

        let outcome;
        try {
            outcome = await writeProjectDocument(cwd, { text }, async (document) => {
                const map = document.getIn(["servers"], true);
                if (!yaml.isMap(map)) return { changed: false, value: { missing: true } };
                const index = map.items.findIndex(
                    (pair) => yaml.isPair(pair) && String(pair.key?.value ?? pair.key) === serverName
                );
                if (index < 0) return { changed: false, value: { missing: true } };
                const pair = map.items[index];
                const comment = index === 0 ? map.commentBefore : pair.key?.commentBefore;
                const comments = typeof comment === "string" && comment.length > 0
                    ? comment.split("\n").length
                    : 0;
                if (!confirm) return { changed: false, value: { comments, preview: true } };
                if (index === 0) map.commentBefore = null;
                map.delete(serverName);
                return { changed: true, backupSuffix: `before-${serverName}-delete`, value: { comments } };
            });
        } catch (error) {
            return failure("project/remove-failed", String(error?.message ?? error), { cwd });
        }
        if (outcome.missing === true) {
            return failure("project/unknown-server", `no server named ${JSON.stringify(serverName)}`, { serverName });
        }
        if (outcome.preview === true) {
            return { ok: true, value: { serverName, comments: outcome.comments, preview: true } };
        }
        return {
            ok: true,
            value: {
                serverName,
                comments: outcome.comments,
                backupPath: outcome.backupPath,
                view: projectView(await readProjectConfig(outcome.root))
            }
        };
    };

    /**
     * 启用或停用项目里的一条服务器。
     *
     * 只增删条目里的 `disabled: true`，配置本身一个字节都不动，因此停用后再启用
     * 能回到原样。停用只影响**新建的会话**：已开启的会话不会重新读取配置。
     * @param payload - `{cwd, text?, serverName, enabled}`。
     * @returns 成功时回传写入后的 `projectView`。
     */
    const projectToggle = async (payload) => {
        const cwd = payload?.cwd;
        const serverName = payload?.serverName;
        const text = payload?.text;
        if (typeof cwd !== "string" || cwd.length === 0) {
            return failure("project/bad-request", "cwd is required");
        }
        if (!validServerName(serverName)) {
            return failure("project/bad-request", "serverName is invalid", { serverName });
        }
        if (typeof payload?.enabled !== "boolean") {
            return failure("project/bad-request", "enabled must be a boolean");
        }
        if (text !== undefined && typeof text !== "string") {
            return failure("project/bad-request", "text must be a string when provided");
        }
        const enabled = payload.enabled;

        let outcome;
        try {
            outcome = await writeProjectDocument(cwd, { text }, async (document) => {
                const map = document.getIn(["servers"], true);
                const entry = yaml.isMap(map) ? map.get(serverName, true) : undefined;
                if (!yaml.isMap(entry)) return { changed: false, value: { missing: true } };
                const disabled = entry.get("disabled") === true;
                // 已经是目标状态就不落盘：重复点击不该产生任何字节变化。
                if (disabled === !enabled) return { changed: false, value: {} };
                if (enabled) entry.delete("disabled");
                else entry.set("disabled", true);
                return { changed: true, value: {} };
            });
        } catch (error) {
            return failure("project/toggle-failed", String(error?.message ?? error), { cwd });
        }
        if (outcome.missing === true) {
            return failure("project/unknown-server", `no server named ${JSON.stringify(serverName)}`, { serverName });
        }
        return { ok: true, value: projectView(await readProjectConfig(outcome.root)) };
    };

    const handler = async (endpoint, payload) => {
        switch (endpoint) {
            case "list": return list();
            case "save": return await save(payload);
            case "remove": return await remove(payload);
            case "project/read": return await projectRead(payload);
            case "project/save": return await projectSave(payload);
            case "project/merge": return await projectMerge(payload);
            case "project/update": return await projectUpdate(payload);
            case "project/remove": return await projectRemove(payload);
            case "project/toggle": return await projectToggle(payload);
            default: return failure("mcp/unknown-endpoint", `unknown endpoint ${JSON.stringify(endpoint)}`);
        }
    };

    // 注册为 `/api` 下的 exact Fetch 路由：认证由 connection 的 `/api` 前缀路由
    // 完成，本处理器只负责把 JSON 请求转成一次业务调用。
    ctx.effect(() => ctx.connection.fetch.register({
        path: API_ROUTE,
        methods: ["POST"],
        requestBody: "buffered",
        fetch: async (request) => {
            let body;
            try {
                body = await request.json();
            } catch (error) {
                return Response.json(failure("mcp/bad-request", `body is not JSON: ${String(error?.message ?? error)}`));
            }
            const endpoint = typeof body?.endpoint === "string" ? body.endpoint : undefined;
            if (endpoint === undefined) {
                return Response.json(failure("mcp/bad-request", "endpoint is required"));
            }
            const result = await handler(endpoint, body?.payload);
            return Response.json(result);
        }
    }), "dsh-mcp-manager: mcp-config fetch route");
}

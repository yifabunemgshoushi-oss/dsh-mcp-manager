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
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

// 依赖归属（见 package.json）：yaml 是第三方库走 dependencies，由 pnpm 安装；
// dsh-atomic-write 在宿主运行时闭包内，声明为 peer 由宿主供给单一实例，
// 因此插件仓库不携带 node_modules，也不应自带副本。
const require = createRequire(import.meta.url);
const yaml = require("yaml");
const { withFileLock, writeFileAtomic } = require("@deepseek-ai/dsh-atomic-write");

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

/**
 * 注册 MCP 读写通道。
 * 认证由 Connection 的 `admit()` 负责，本函数不重复实现信任检查。
 * @param ctx - 已注入所需服务的插件上下文。
 */
export function apply(ctx) {
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
     * @param payload - `{id, config, create}`。
     * @returns 成功时回传 `{id, created, applied}`。
     */
    const save = async (payload) => {
        const id = payload?.id;
        const config = payload?.config;
        const create = payload?.create === true;
        if (typeof id !== "string" || id.length === 0) {
            return failure("mcp/bad-request", "id is required");
        }
        if (!validPatchId(id)) {
            return failure("mcp/invalid-row-id", "id must match ^[A-Za-z0-9_-]{1,32}$", { id });
        }
        const reason = validateConfig(config);
        if (reason !== undefined) return failure("mcp/invalid-config", reason, { id });

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
                    block.commentBefore = `由 MCP 管理器新增（${stamp()}）`;
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

    const handler = async (endpoint, payload) => {
        switch (endpoint) {
            case "list": return list();
            case "save": return await save(payload);
            case "remove": return await remove(payload);
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

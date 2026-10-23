/**
 * dsh-mcp-manager 的浏览器半侧。
 *
 * 方案 B：列出 MCP 服务器（含真实字段）并编辑保存。
 *
 * 数据来源：Host 半注册的 `/api/mcp-config` Fetch 路由（POST `{endpoint, payload}`）。
 * 为什么不用现成 Remote：
 *   - `remote.pluginManager` 只能读写 `disabled`，拿不到 url / command 等字段；
 *   - `configForms` / `remote.settings` 读不到这些行 —— mcp-client 的 Config 是
 *     顶层 `z.union` 且无 `.volatile()`，Host 的 `volatileForm()` 对 union 返回
 *     undefined，`describe()` 于是整条过滤掉，写入也会被硬拒绝。
 * 因此字段级读写必须经 Host 半的 `configEditor`。
 *
 * 依赖策略：只 require 平台种子模块（react / react/jsx-runtime），不 import 任何
 * `@deepseek-ai/dsh-client-*` 包；样式只用 `--dsw-alias-*` 主题 token，使 DSH 升级
 * 最多导致外观降级，而不会让本 slot 条目崩掉。
 */

window.__ModuleLoader__.load({
    id: "dsh-mcp-manager",
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        const React = require("react");
        const { jsx, jsxs } = require("react/jsx-runtime");

        //#region 文案
        /** 本插件拥有的字典命名空间。 */
        const NS = "settings.mcpManager";

        const zh = {
            nav: "MCP 服务器",
            title: "MCP 服务器",
            intro: "当前 profile 里的 MCP 连接，可直接编辑并保存回 cordis.patch.yml。",
            loading: "正在读取…",
            empty: "当前 profile 里没有 MCP 服务器。",
            retry: "重试",
            errorLabel: "错误",
            forbidden: "访问被拒绝：MCP 管理仅对本机主人可用",
            enabled: "已启用",
            disabled: "已停用",
            // 动作词与状态词分开：按钮说「点下去会发生什么」，标签说「现在是什么」。
            disableAction: "停用",
            enableAction: "启用",
            phase: "运行状态",
            serverName: "serverName",
            transport: "传输方式",
            target: "目标",
            tools: "工具",
            toolCount: "工具数",
            toggle: "启用/停用",
            readOnly: "该行不可通过 profile patch 寻址。",
            edit: "编辑",
            back: "返回列表",
            save: "保存",
            saving: "保存中…",
            saved: "已保存，配置已热生效",
            savedPending: "已写入 cordis.patch.yml，但运行时未重载该行；重启 DSH 后生效。",
            discard: "放弃修改",
            dirty: "有未保存的修改",
            command: "命令",
            args: "参数（每行一个）",
            cwd: "工作目录",
            url: "URL",
            headers: "请求头（每行一个 KEY=VALUE）",
            timeout: "工具调用超时（毫秒）",
            failOnStartup: "启动失败即报错",
            reconnect: "断线自动重连",
            notEditable: "该字段为高级配置，请在 cordis.patch.yml 中编辑。",
            add: "新增服务器",
            addTitle: "新增服务器",
            addHint: "填写后保存即追加到 cordis.patch.yml，无需手工编辑文件。",
            note: "保存写入 profile patch，Host 会热重载该行，无需重启。",
            rowGone: "该行已不存在，请重新读取列表",
            badRowId: "patch 行 id 只能包含字母、数字、下划线和连字符，长度 1–32",
            removed: "已删除，原文已备份到同目录的 .bak 文件",
            removedPending: "已从 cordis.patch.yml 删除，但运行时还没移除该行；重启 DSH 后生效。",
            importTitle: "从 JSON 导入",
            importPlaceholder: "粘贴 {\"mcpServers\": { ... }} 片段",
            importParse: "解析并导入",
            importHint: "解析后逐条进入编辑页，保存即追加，可跳过。",
            warningsLabel: "转换告警",
            rowIdLabel: "patch 行 id",
            comment: "注释（可选）",
            commentHint: "写在 insert 块上方，用来说明这台服务器；留空则自动生成时间注释。",
            skip: "跳过此条",
            remove: "删除",
            removeAsk: "确认删除？",
            removeNote: "将同时删除该 insert 块上方的注释，并先把原文备份到同目录。",
            commentLines: "行注释",
            removeYes: "确认删除",
            removeNo: "取消",
            importDone: "导入结束",
            importSaved: "条已保存",
            importSkipped: "条已跳过",
            // 项目级
            tabGlobal: "全局",
            tabProject: "项目",
            projectIntro: "按项目隔离的 MCP：配置写在项目根目录的 .dsh/mcp.yml，只对该目录下新建的会话生效。项目条目优先于全局同名服务器。",
            noWorkspace: "还没有工作区。先在侧边栏打开一个项目目录，这里就会出现它。",
            projectFile: "配置文件",
            projectRoot: "项目根",
            projectMissing: "尚不存在，保存时创建",
            projectServers: "服务器",
            projectDisabled: "禁用全局",
            projectProblems: "配置问题",
            projectReload: "重新读取",
            projectSave: "保存配置",
            projectSaved: "已保存，新建的会话生效",
            projectSaveHint: "保存后只对新建的会话生效；已开启的会话保持原样。",
            projectImportTitle: "从 .mcp.json 转换",
            projectImportPlaceholder: "粘贴 {\"mcpServers\": { ... }} 片段",
            projectImportAction: "转换并填入编辑器",
            projectImportHint: "只把转换结果写进上方编辑器，仍需点保存才会落盘。",
            projectOverwritten: "覆盖同名条目",
            projectLoading: "正在读取…",
            projectEmptyServers: "这个项目还没有服务器",
            projectAddHint: "保存即写进 .dsh/mcp.yml，直接落盘，无需再点一次保存。",
            projectOverrides: "覆盖全局",
            projectDisabledNote: "已停用：这个项目不挂载它；同名全局服务器的工具也会被遮住。",
            projectCardHint: "卡片操作直接写入 .dsh/mcp.yml，只对新建的会话生效。",
            projectToggleNote: "启停只对新建的会话生效。",
            projectDirty: "源码编辑器有未保存的修改：卡片操作会以那份文本为基底一并写入。",
            projectSourceShow: "展开源码",
            projectSourceHide: "收起源码",
            projectSourceHint: "直接编辑 .dsh/mcp.yml 原文（保留注释、顺序与 disableGlobal），作为卡片之外的备用手段。",
            projectRemoveAsk: "确认删除这条服务器？",
            projectRemoveNote: "会一并删掉它上方的注释，并先把原文备份到同目录。",
            projectRemoved: "已删除：",
            projectDisabledSaved: "已停用，新建的会话不再挂载它",
            projectEnabledSaved: "已启用，新建的会话会挂载它",
            serverNameLocked: "serverName 就是配置里的键，改名请删除后重新添加。",
            cancel: "取消",
        };

        const en = {
            nav: "MCP servers",
            title: "MCP servers",
            intro: "MCP connections in the current profile; edit and save them back to cordis.patch.yml.",
            loading: "Reading…",
            empty: "No MCP server in this profile yet.",
            retry: "Retry",
            errorLabel: "Error",
            forbidden: "Access denied: MCP management is available to the local owner only",
            enabled: "Enabled",
            disabled: "Disabled",
            disableAction: "Disable",
            enableAction: "Enable",
            phase: "Status",
            serverName: "serverName",
            transport: "Transport",
            target: "Target",
            tools: "Tools",
            toolCount: "Tools",
            toggle: "Toggle",
            readOnly: "This row is not addressable through the profile patch.",
            edit: "Edit",
            back: "Back to list",
            save: "Save",
            saving: "Saving…",
            saved: "Saved; the configuration is live",
            savedPending: "Written to cordis.patch.yml, but the runtime did not reload the row; restart DSH to apply it.",
            discard: "Discard",
            dirty: "Unsaved changes",
            command: "Command",
            args: "Arguments (one per line)",
            cwd: "Working directory",
            url: "URL",
            headers: "Headers (one KEY=VALUE per line)",
            timeout: "Tool-call timeout (ms)",
            failOnStartup: "Fail on startup error",
            reconnect: "Reconnect automatically",
            notEditable: "This field is advanced configuration; edit it in cordis.patch.yml.",
            add: "New server",
            addTitle: "New server",
            addHint: "Saving appends the row to cordis.patch.yml; no manual editing needed.",
            note: "Saving writes the profile patch; the Host hot-reloads that row, no restart needed.",
            rowGone: "That row no longer exists; reload the list",
            badRowId: "Row id allows letters, digits, underscore and hyphen, length 1-32",
            removed: "Deleted; the previous text is backed up next to the patch as a .bak file",
            removedPending: "Removed from cordis.patch.yml, but the runtime still has the row; restart DSH to apply it.",
            importTitle: "Import from JSON",
            importPlaceholder: "Paste a {\"mcpServers\": { ... }} snippet",
            importParse: "Parse and import",
            importHint: "Each entry opens in the editor; saving appends it. Skipping is allowed.",
            warningsLabel: "Conversion warnings",
            rowIdLabel: "Row id",
            comment: "Comment (optional)",
            commentHint: "Written above the insert block to describe this server; left empty, a timestamped comment is generated.",
            skip: "Skip this one",
            remove: "Delete",
            removeAsk: "Delete this row?",
            removeNote: "The comments above this insert block are removed too, after backing up the original text.",
            commentLines: "comment lines",
            removeYes: "Delete",
            removeNo: "Cancel",
            importDone: "Import finished",
            importSaved: "saved",
            importSkipped: "skipped",
            // Project level
            tabGlobal: "Global",
            tabProject: "Project",
            projectIntro: "Project-scoped MCP: the configuration lives in <project root>/.dsh/mcp.yml and applies to sessions created in that directory. Project entries win over global ones with the same name.",
            noWorkspace: "No workspace yet. Open a project directory from the sidebar and it shows up here.",
            projectFile: "Config file",
            projectRoot: "Project root",
            projectMissing: "not created yet; saving creates it",
            projectServers: "servers",
            projectDisabled: "Disabled global",
            projectProblems: "Config problems",
            projectReload: "Reload",
            projectSave: "Save config",
            projectSaved: "Saved; new sessions pick it up",
            projectSaveHint: "Saving only affects sessions created afterwards; running sessions keep their servers.",
            projectImportTitle: "Convert from .mcp.json",
            projectImportPlaceholder: "Paste a {\"mcpServers\": { ... }} snippet",
            projectImportAction: "Convert into the editor",
            projectImportHint: "The result only lands in the editor above; saving is still a separate click.",
            projectOverwritten: "overwrote",
            projectLoading: "Reading…",
            projectEmptyServers: "This project has no server yet",
            projectAddHint: "Saving writes the server into .dsh/mcp.yml immediately; no second save step.",
            projectOverrides: "Overrides global",
            projectDisabledNote: "Disabled: this project does not mount it, and the global server with the same name is masked too.",
            projectCardHint: "Card actions write straight into .dsh/mcp.yml and only affect new sessions.",
            projectToggleNote: "Enabling or disabling only affects new sessions.",
            projectDirty: "The source editor has unsaved changes; card actions use that text as the base and write it too.",
            projectSourceShow: "Show source",
            projectSourceHide: "Hide source",
            projectSourceHint: "Edit the raw .dsh/mcp.yml (comments, order and disableGlobal preserved) as a fallback next to the cards.",
            projectRemoveAsk: "Delete this server?",
            projectRemoveNote: "The comments above it are removed too, after backing up the original text to the same directory.",
            projectRemoved: "Deleted: ",
            projectDisabledSaved: "Disabled; new sessions no longer mount it",
            projectEnabledSaved: "Enabled; new sessions mount it",
            serverNameLocked: "serverName is the key in the config; delete and re-add to rename it.",
            cancel: "Cancel",
        };
        //#endregion

        //#region 传输
        /** Host 的 Fetch 路由，与 lib/index.js 的 API_ROUTE 必须一致。 */
        const API_ROUTE = "/api/mcp-config";

        /**
         * 调一次 Host 的 MCP 端点。
         *
         * 走 `/api` 下的 exact Fetch 路由，而不是 connection.rpc：后者在 Host 侧
         * 注册路由时会访问 shadow 上下文上的 webServer 而失败（详见 lib/index.js）。
         * 认证由 connection 已注册的 `/api` 前缀路由代管，浏览器端只需带同样的凭据
         * 发一次 POST。传输故障抛出，业务失败以 `{ok:false,error}` 返回。
         * @param endpoint - 业务端点名，例如 `list` / `project/read`。
         * @param payload - 端点参数。
         * @returns Host 的 JSON 结果。
         */
        async function callApi(endpoint, payload) {
            const response = await fetch(API_ROUTE, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ endpoint, payload: payload ?? {} })
            });
            // 0.2.1 起 exact Fetch 路由只接受 owner 身份；operator（远程访问）会拿到 403，
            // 这不是传输故障，调用方据 status 单独报成可读原因。
            if (!response.ok) {
                const error = new Error(response.status === 403 ? "forbidden" : `HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return await response.json();
        }

        /** `{ok:false,error}` → 可读消息。 */
        function detailText(result) {
            return result?.error ? `${result.error.code}: ${result.error.message}` : "unknown failure";
        }

        /** 传输层异常 → 可读消息。 */
        function callErrorText(error, t) {
            if (error?.status === 403) return t("forbidden");
            return `传输失败：${String(error?.message ?? error)}`;
        }
        //#endregion

        //#region 纯函数
        /** serverName 的合法形状（与 mcp-client 的 pattern 一致）。 */
        const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;

        /** JSON 片段里已知的键；其余键会被明确告知「没有对应项」。 */
        const KNOWN_JSON_KEYS = new Set(["type", "command", "args", "env", "cwd", "url", "headers", "disabled", "alwaysAllow"]);

        /** JSON 里的 env/headers 值可能是数字或布尔，而 schema 要求字符串值。 */
        function stringRecord(value) {
            if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
            const record = {};
            for (const [key, item] of Object.entries(value)) record[key] = typeof item === "string" ? item : String(item);
            return record;
        }

        /**
         * 把一段 MCP 生态通用的 `mcpServers` JSON 解析成候选配置。
         *
         * 这段 JSON 没有 `transport`，只能靠字段推断：有 `command` 视为 stdio，有 `url`
         * 视为 streamable-http。dsh-mcp-client 只支持这两个传输，所以 `"type": "sse"`
         * 只能映射成 streamable-http **并告警**——不能假装转成功。
         *
         * 推断必然有歧义，因此每条候选都带 `warnings`，由界面在保存前逐条展示。
         * @param text - 用户粘贴的 JSON。
         * @returns `{candidates}` 或 `{error}`；候选为 `{serverName, config, warnings}`。
         */
        function parseMcpServers(text) {
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (error) {
                return { error: `JSON 解析失败：${String(error?.message ?? error)}` };
            }
            const servers = parsed?.mcpServers ?? parsed?.servers;
            if (servers === null || typeof servers !== "object" || Array.isArray(servers)) {
                return { error: "找不到 mcpServers 对象，请粘贴形如 {\"mcpServers\": {...}} 的片段" };
            }

            const candidates = [];
            for (const [rawName, entry] of Object.entries(servers)) {
                const warnings = [];
                if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
                    warnings.push("条目不是对象，已跳过");
                    continue;
                }

                let serverName = String(rawName);
                const normalized = serverName.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
                if (normalized !== serverName) {
                    warnings.push(`serverName ${JSON.stringify(serverName)} 含非法字符或过长，已规范为 ${JSON.stringify(normalized)}`);
                    serverName = normalized;
                }

                const config = {};
                const type = typeof entry.type === "string" ? entry.type.toLowerCase() : undefined;
                if (typeof entry.url === "string" && entry.url.length > 0) {
                    config.transport = "streamable-http";
                    config.url = entry.url;
                    if (type === "sse") {
                        warnings.push('type 是 "sse"，而 dsh-mcp-client 只支持 stdio / streamable-http；已按 streamable-http 导入，请确认该端点确实支持');
                    } else if (type !== undefined && type !== "http" && type !== "streamable-http") {
                        warnings.push(`type ${JSON.stringify(entry.type)} 没有对应传输，已按 streamable-http 导入`);
                    }
                    const headers = stringRecord(entry.headers);
                    if (Object.keys(headers).length > 0) config.headers = headers;
                } else if (typeof entry.command === "string" && entry.command.length > 0) {
                    config.transport = "stdio";
                    config.command = entry.command;
                    if (Array.isArray(entry.args) && entry.args.length > 0) config.args = entry.args.map((value) => String(value));
                    const env = stringRecord(entry.env);
                    if (Object.keys(env).length > 0) config.env = env;
                    if (typeof entry.cwd === "string" && entry.cwd.length > 0) config.cwd = entry.cwd;
                } else {
                    warnings.push("既没有 url 也没有 command，无法判断传输，已跳过");
                    continue;
                }

                config.serverName = serverName;
                if (entry.disabled === true) {
                    warnings.push("disabled: true 在这边由「停用」按钮管理，导入后请手动停用一次");
                }
                for (const key of Object.keys(entry)) {
                    if (!KNOWN_JSON_KEYS.has(key)) warnings.push(`字段 ${JSON.stringify(key)} 没有对应项，已忽略`);
                }
                candidates.push({ serverName, config, warnings });
            }

            if (candidates.length === 0) return { error: "mcpServers 里没有可导入的条目" };
            return { candidates };
        }

        /** fiber 阶段 → 共享状态语义。 */
        function stateOf(phase) {
            if (phase === "loading" || phase === "unloading") return "ongoing";
            if (phase === "active") return "done";
            if (phase === "failed") return "error";
            return "idle";
        }

        /**
         * 由 serverName 派生一个默认的 patch 行 id。
         *
         * 新增表单里不该要求用户理解「patch 行 id」是什么：默认值跟着 serverName 走，
         * 需要自定义时仍可手改。截断到 28 字符是为了给 `mcp-` 前缀留出余量，让最终
         * id 落在 `^[A-Za-z0-9_-]{1,32}$` 之内（serverName 本身可达 32 字符）。
         * @param serverName - 表单里的 serverName。
         * @returns 形如 `mcp-<name>` 的行 id。
         */
        function rowIdFor(serverName) {
            const normalized = String(serverName).trim().replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 28);
            return `mcp-${normalized}`;
        }

        /** 多行文本 → 字符串数组（丢弃空行）。 */
        function linesToArray(text) {
            return String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
        }

        /** 字符串数组 → 多行文本。 */
        function arrayToLines(list) {
            return Array.isArray(list) ? list.join("\n") : "";
        }

        /** KEY=VALUE 多行文本 → 对象；非法行原样跳过并由校验提示。 */
        function linesToRecord(text) {
            const record = {};
            for (const line of linesToArray(text)) {
                const at = line.indexOf("=");
                if (at <= 0) continue;
                record[line.slice(0, at).trim()] = line.slice(at + 1).trim();
            }
            return record;
        }

        /** 对象 → KEY=VALUE 多行文本。 */
        function recordToLines(record) {
            if (record === null || typeof record !== "object") return "";
            return Object.entries(record).map(([key, value]) => `${key}=${String(value)}`).join("\n");
        }

        /**
         * 从「可编辑草稿」构造待提交的完整 config。
         *
         * 两条规则：
         * 1. 以**原有 config 为基底**再覆盖表单管理的字段，而不是从零构造。因为
         *    写入的是我们返回的整个对象，任何未在表单暴露的字段（例如
         *    `maxInstructionBytes`）若被丢弃，就会从 profile patch 里静默消失。
         * 2. 只覆盖**相对原配置确有改动**的字段。否则表单里的默认值（空 env/cwd、
         *    未勾选的开关等）每次保存都会被实体化成新行，把手工维护的配置越写越胖。
         * 切换传输方式时需删除属于另一种传输的键，避免把 stdio 的字段留在 http 行上。
         * @param draft - 表单草稿。
         * @param original - 该行当前的完整配置（作为保留基底与改动基准）。
         * @returns 待提交的完整配置。
         */
        function draftToConfig(draft, original) {
            const base = original === null || typeof original !== "object" ? {} : JSON.parse(JSON.stringify(original));
            const before = configToDraft(base);
            const config = { ...base };

            if (draft.transport !== before.transport) {
                if (draft.transport === "stdio") {
                    delete config.url;
                    delete config.headers;
                } else {
                    delete config.command;
                    delete config.args;
                    delete config.env;
                    delete config.cwd;
                }
            }
            config.transport = draft.transport;

            /** 有改动才覆盖；被清空的字段直接删除，未改动的键保持文件原样。 */
            const put = (key, field, value) => {
                if (draft[field] === before[field]) return;
                const empty = value === "" || value === undefined
                    || (Array.isArray(value) && value.length === 0)
                    || (typeof value === "object" && value !== null && Object.keys(value).length === 0);
                if (empty) {
                    delete config[key];
                    return;
                }
                config[key] = value;
            };

            put("serverName", "serverName", draft.serverName.trim());
            if (draft.transport === "stdio") {
                put("command", "command", draft.command.trim());
                put("args", "args", linesToArray(draft.args));
                put("env", "env", linesToRecord(draft.env));
                put("cwd", "cwd", draft.cwd.trim());
            } else {
                put("url", "url", draft.url.trim());
                put("headers", "headers", linesToRecord(draft.headers));
            }
            put("toolCallTimeoutMs", "toolCallTimeoutMs",
                draft.toolCallTimeoutMs.trim() === "" ? undefined : Number(draft.toolCallTimeoutMs.trim()));

            if (draft.failOnStartupError !== before.failOnStartupError) {
                if (draft.failOnStartupError === true) config.failOnStartupError = true;
                else delete config.failOnStartupError;
            }
            // reconnect 在 schema 里还有 initialDelayMs 等字段，合并而非替换。
            if (draft.reconnect !== before.reconnect) {
                const reconnect = config.reconnect !== null && typeof config.reconnect === "object" ? config.reconnect : {};
                reconnect.enabled = draft.reconnect === true;
                config.reconnect = reconnect;
            }
            return config;
        }

        /** Host 配置 → 可编辑草稿。 */
        function configToDraft(config) {
            const c = config ?? {};
            const stdio = c.transport === "stdio";
            return {
                transport: stdio ? "stdio" : "streamable-http",
                serverName: typeof c.serverName === "string" ? c.serverName : "",
                command: typeof c.command === "string" ? c.command : "",
                args: arrayToLines(c.args),
                env: recordToLines(c.env),
                cwd: typeof c.cwd === "string" ? c.cwd : "",
                url: typeof c.url === "string" ? c.url : "",
                headers: recordToLines(c.headers),
                toolCallTimeoutMs: typeof c.toolCallTimeoutMs === "number" ? String(c.toolCallTimeoutMs) : "",
                failOnStartupError: c.failOnStartupError === true,
                reconnect: c.reconnect?.enabled !== false
            };
        }

        /** 客户端校验草稿，返回错误消息或 undefined。 */
        function validateDraft(draft) {
            if (!SERVER_NAME.test(draft.serverName.trim())) {
                return "serverName 只能包含字母、数字、下划线和连字符，长度 1–32";
            }
            if (draft.transport === "stdio") {
                if (draft.command.trim().length === 0) return "stdio 传输必须填写命令";
            } else {
                const url = draft.url.trim();
                if (url.length === 0) return "streamable-http 传输必须填写 URL";
                try {
                    new URL(url);
                } catch {
                    return "URL 必须是合法的绝对地址";
                }
            }
            const timeout = draft.toolCallTimeoutMs.trim();
            if (timeout.length > 0) {
                const value = Number(timeout);
                if (!Number.isFinite(value) || value < 1) return "超时必须是正数";
            }
            // 与 Host 的 normalizeComment 保持同一口径：先去掉首尾空行再数行。
            const commentLines = (draft.comment ?? "").split(/\r?\n/).map((line) => line.trim());
            while (commentLines.length > 0 && commentLines[0] === "") commentLines.shift();
            while (commentLines.length > 0 && commentLines[commentLines.length - 1] === "") commentLines.pop();
            if (commentLines.length > 20) return "注释最多 20 行";
            if (commentLines.join("\n").length > 1000) return "注释最多 1000 字";
            return undefined;
        }
        //#endregion

        //#region 样式（只用主题 token）
        const S = {
            page: {
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                maxWidth: "760px",
                width: "100%",
                color: "var(--dsw-alias-label-primary)"
            },
            h2: { margin: 0, fontSize: "16px", fontWeight: 600 },
            intro: { margin: 0, fontSize: "13px", color: "var(--dsw-alias-label-secondary)" },
            list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" },
            card: {
                border: "1px solid var(--dsw-alias-border-l2)",
                borderRadius: "var(--dsw-radius-md, 8px)",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                background: "var(--dsw-alias-bg-layer-1)"
            },
            cardHead: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
            name: { fontWeight: 600, fontSize: "14px" },
            meta: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
            mono: { fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)", fontSize: "12px", wordBreak: "break-all" },
            tag: {
                fontSize: "12px",
                borderRadius: "var(--dsw-radius-sm, 4px)",
                padding: "1px 6px",
                border: "1px solid var(--dsw-alias-border-l2)",
                color: "var(--dsw-alias-label-secondary)"
            },
            spacer: { flex: 1 },
            actions: { display: "flex", alignItems: "center", gap: "6px" },
            button: {
                font: "inherit",
                fontSize: "13px",
                cursor: "pointer",
                borderRadius: "var(--dsw-radius-sm, 6px)",
                // 必须用长写而不是 `border` 简写：tab 的选中态只覆盖 borderColor，
                // React 移除该长写时若发现同一 style 里还有 `border` 简写，会把简写
                // 一起丢掉，按钮于是退回浏览器默认边框（深色下表现为白边只增不减）。
                // 拆成长写后，选中/取消选中都能正确切换。
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "var(--dsw-alias-border-l2)",
                background: "transparent",
                color: "var(--dsw-alias-label-primary)",
                padding: "4px 10px"
            },
            // 只用主题真实提供的 alias token。此前用的 button-primary-fill /
            // button-primary-label 并不存在：前者回退成 transparent，后者却存在且
            // 是白色前景，导致白底白字、主按钮整块看不见。
            primary: {
                borderColor: "var(--dsw-alias-brand-primary)",
                color: "var(--dsw-alias-brand-primary)"
            },
            danger: { color: "var(--dsw-alias-state-error-primary)" },
            ok: { color: "var(--dsw-alias-state-success-primary)" },
            field: { display: "flex", flexDirection: "column", gap: "3px" },
            label: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
            input: {
                font: "inherit",
                fontSize: "13px",
                padding: "4px 6px",
                borderRadius: "var(--dsw-radius-sm, 6px)",
                border: "1px solid var(--dsw-alias-border-l2)",
                background: "var(--dsw-alias-bg-layer-2)",
                color: "var(--dsw-alias-label-primary)",
                width: "100%",
                boxSizing: "border-box"
            },
            textarea: {
                fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)",
                fontSize: "12px",
                padding: "4px 6px",
                borderRadius: "var(--dsw-radius-sm, 6px)",
                border: "1px solid var(--dsw-alias-border-l2)",
                background: "var(--dsw-alias-bg-layer-2)",
                color: "var(--dsw-alias-label-primary)",
                width: "100%",
                boxSizing: "border-box",
                resize: "vertical"
            },
            checkboxRow: { display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" },
            note: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
            importBox: { display: "flex", flexDirection: "column", gap: "6px" },
            warnBox: { display: "flex", flexDirection: "column", gap: "2px" },
            tools: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" },
            tabs: { display: "flex", alignItems: "center", gap: "6px" },
            tabActive: {
                borderColor: "var(--dsw-alias-brand-primary)",
                color: "var(--dsw-alias-brand-primary)"
            },
            pathRow: { display: "flex", flexDirection: "column", gap: "2px" }
        };
        //#endregion

        //#region Controller
        /**
         * MCP 列表与编辑状态的所有者。
         *
         * 每次 publish 发布全新快照：渲染层按 Object.is 判断 selector 结果变化，
         * 原地改同一对象会让它跳过重渲染。
         */
        class McpController {
            constructor(ctx) {
                this.ctx = ctx;
                this.t = ctx.locale.bind(NS);
                this.listeners = new Set();
                this.snapshot = {
                    status: "idle",
                    rows: [],
                    error: null,
                    notice: null,
                    busy: [],
                    editingId: null,
                    draft: null,
                    draftError: null,
                    importText: "",
                    importError: null,
                    /** 待逐条导入的候选；`queueIndex` 指向当前正在编辑的那条。 */
                    queue: [],
                    queueIndex: 0,
                    savedCount: 0,
                    skippedCount: 0,
                    /** 当前编辑的是「新建行」而不是既有行。 */
                    isNew: false,
                    /** 新建态下行 id 是否已被用户手改（未改则跟着 serverName 走）。 */
                    rowIdTouched: false,
                    /** 当前草稿的转换告警（来自 JSON 导入）。 */
                    warnings: [],
                    /** 待删除的行 id 与预检结果，等待用户确认。 */
                    removeTarget: null,
                    removeComments: 0
                };
            }

            getSnapshot() {
                return this.snapshot;
            }

            subscribe(listener) {
                this.listeners.add(listener);
                return () => {
                    this.listeners.delete(listener);
                };
            }

            patch(next) {
                this.snapshot = { ...this.snapshot, ...next };
                for (const listener of [...this.listeners]) listener();
            }

            /**
             * 调一次 Host 的 MCP 端点（传输细节见模块级的 `callApi`）。
             *
             * 这里只补一件事：把 403 换成当前语言的说明。远程访问者（operator）
             * 会拿到 403，那不是传输故障，直接显示 `HTTP 403` 会误导人。
             */
            async call(endpoint, payload) {
                try {
                    return await callApi(endpoint, payload);
                } catch (error) {
                    if (error?.status !== 403) throw error;
                    const denied = new Error(this.t("forbidden"));
                    denied.status = 403;
                    throw denied;
                }
            }

            /** 读取权威数据。任何失败都显式落到 error 状态，不静默吞掉。 */
            async load() {
                this.patch({ status: "loading", error: null });
                let result;
                try {
                    result = await this.call("list");
                } catch (error) {
                    const message = String(error?.message ?? error);
                    this.patch({ status: "error", error: error?.status === 403 ? message : `传输失败：${message}` });
                    return;
                }
                if (result === null || result.ok !== true) {
                    const detail = result?.error ? `${result.error.code}: ${result.error.message}` : "unknown failure";
                    this.patch({ status: "error", error: detail });
                    return;
                }
                const rows = (result.value?.rows ?? []).map((row) => ({ ...row, state: stateOf(row.phase) }));
                this.patch({ status: "ready", rows, error: null });
            }

            ensure() {
                if (this.snapshot.status === "idle") void this.load();
            }

            /** 进入编辑：用当前配置初始化草稿。`id` 为 profile patch 行 id。 */
            edit(id) {
                const row = this.snapshot.rows.find((item) => item.patchId === id);
                if (row === undefined) return;
                this.patch({
                    editingId: id,
                    draft: configToDraft(row.config),
                    draftError: null,
                    notice: null,
                    // 编辑既有行时必须显式退出「新建」语义，否则保存会以 create 提交。
                    isNew: false,
                    rowIdTouched: true,
                    warnings: []
                });
            }

            /**
             * 进入「新增服务器」编辑态：空草稿 + 自动行 id。
             *
             * 与 JSON 导入共用同一条新建通路（`isNew` + `save` 的 create 分支），
             * 因此这里也要清掉导入队列的计数，避免保存后被当成导入的一条。
             */
            startCreate() {
                this.patch({
                    editingId: rowIdFor(""),
                    // comment 不属于 config，单独挂在草稿上随保存提交。
                    draft: { ...configToDraft({}), comment: "" },
                    isNew: true,
                    rowIdTouched: false,
                    warnings: [],
                    draftError: null,
                    notice: null,
                    queue: [],
                    queueIndex: 0,
                    savedCount: 0,
                    skippedCount: 0
                });
            }

            /** 更新草稿的单个字段。 */
            updateDraft(field, value) {
                if (this.snapshot.draft === null) return;
                const next = { draft: { ...this.snapshot.draft, [field]: value }, draftError: null };
                // 新建态下 serverName 是用户最先填的字段：行 id 跟着它派生，省一步手填。
                if (field === "serverName" && this.snapshot.isNew && !this.snapshot.rowIdTouched) {
                    next.editingId = rowIdFor(value);
                }
                this.patch(next);
            }

            /** 切换传输方式时清理不相干字段，避免把 stdio 的键带进 http 行。 */
            setTransport(transport) {
                if (this.snapshot.draft === null) return;
                this.patch({ draft: { ...this.snapshot.draft, transport }, draftError: null });
            }

            /** 放弃编辑。新建态要一并复位，否则下次编辑既有行会残留 create 语义。 */
            cancelEdit() {
                this.patch({
                    editingId: null,
                    draft: null,
                    draftError: null,
                    isNew: false,
                    rowIdTouched: false,
                    warnings: []
                });
            }

            /** 把 `{ok:false,error}` 变成可读消息。 */
            detailOf(result) {
                return result?.error ? `${result.error.code}: ${result.error.message}` : "unknown failure";
            }

            /** 记录粘贴的 JSON 文本。 */
            setImportText(value) {
                this.patch({ importText: value, importError: null });
            }

            /**
             * 解析粘贴的 JSON 并进入导入队列。
             *
             * 逐条进编辑页而不是弹二次选择：编辑页本身就是最好的预览——用户能在那里
             * 改 transport、补超时，也能看到转换告警，不必维护第二套确认界面。
             */
            startImport() {
                const parsed = parseMcpServers(this.snapshot.importText ?? "");
                if (parsed.error !== undefined) {
                    this.patch({ importError: parsed.error });
                    return;
                }
                this.patch({
                    importError: null,
                    queue: parsed.candidates,
                    queueIndex: 0,
                    savedCount: 0,
                    skippedCount: 0
                });
                this.openQueued();
            }

            /** 打开队列里当前这一条的「新建」编辑态；队列走完就汇总收尾。 */
            openQueued() {
                const { queue, queueIndex } = this.snapshot;
                if (queueIndex >= queue.length) {
                    this.finishImport();
                    return;
                }
                const candidate = queue[queueIndex];
                this.patch({
                    editingId: `mcp-${candidate.serverName}`,
                    draft: { ...configToDraft(candidate.config), comment: "" },
                    warnings: candidate.warnings,
                    isNew: true,
                    // 导入的行 id 已由 serverName 定好，改 serverName 不该顺带改 id。
                    rowIdTouched: true,
                    draftError: null
                });
            }

            /** 结束导入并汇总成功/跳过条数。 */
            finishImport() {
                const { savedCount, skippedCount } = this.snapshot;
                this.patch({
                    queue: [],
                    queueIndex: 0,
                    savedCount: 0,
                    skippedCount: 0,
                    editingId: null,
                    draft: null,
                    isNew: false,
                    rowIdTouched: false,
                    warnings: [],
                    notice: `${this.t("importDone")}：${savedCount} ${this.t("importSaved")}`
                        + (skippedCount > 0 ? `，${skippedCount} ${this.t("importSkipped")}` : "")
                });
            }

            /** 跳过当前这条，继续下一条。 */
            skipCurrent() {
                if (this.snapshot.queue.length === 0) {
                    this.cancelEdit();
                    return;
                }
                this.patch({
                    queueIndex: this.snapshot.queueIndex + 1,
                    skippedCount: this.snapshot.skippedCount + 1,
                    draftError: null
                });
                this.openQueued();
            }

            /** 新建行时允许自定义 patch 行 id。 */
            setRowId(value) {
                this.patch({ editingId: value, rowIdTouched: true, draftError: null });
            }

            /** 删除第一步：只预检「会一起删掉几行注释」，Host 不写文件。 */
            async removeRequest(row) {
                if (this.snapshot.busy.includes(row.patchId)) return;
                this.patch({ busy: [...this.snapshot.busy, row.patchId], error: null, notice: null });
                try {
                    const result = await this.call("remove", { id: row.patchId });
                    if (result === null || result.ok !== true) throw new Error(this.detailOf(result));
                    this.patch({ removeTarget: row.patchId, removeComments: result.value?.comments ?? 0 });
                } catch (error) {
                    this.patch({ error: String(error?.message ?? error) });
                    // 这一行可能已经不在文件里了：重读一次列表，别让不存在的行继续挂在界面上。
                    await this.load();
                } finally {
                    this.patch({ busy: this.snapshot.busy.filter((id) => id !== row.patchId) });
                }
            }

            /** 删除第二步：确认后真正删除（Host 会先把原始全文备份到同目录）。 */
            async removeConfirm() {
                const id = this.snapshot.removeTarget;
                if (id === null) return;
                this.patch({ busy: [...this.snapshot.busy, id], removeTarget: null });
                try {
                    const result = await this.call("remove", { id, confirm: true });
                    if (result === null || result.ok !== true) throw new Error(this.detailOf(result));
                    await this.load();
                    this.patch({
                        notice: result.value?.applied === false ? this.t("removedPending") : this.t("removed")
                    });
                } catch (error) {
                    this.patch({ error: String(error?.message ?? error) });
                    // 行可能已在别处被删掉：重读列表，避免继续显示一行不存在的服务器。
                    await this.load();
                } finally {
                    this.patch({ busy: this.snapshot.busy.filter((item) => item !== id) });
                }
            }

            removeCancel() {
                this.patch({ removeTarget: null, removeComments: 0 });
            }

            /**
             * 保存草稿；新建态下保存即追加一行。
             *
             * 追加之后分两种收尾：来自 JSON 导入队列的继续打开下一条，单条「新增服务器」
             * 则直接回到列表并提示已保存。
             */
            async save() {
                const { editingId, draft, isNew } = this.snapshot;
                if (editingId === null || draft === null) return;
                // 按钮的 disabled 要等一次重渲染才生效，快速连点仍会重入；这里用 busy
                // 兜底，否则同一次编辑会并发写盘、并触发多轮重载与界面闪动。
                if (this.snapshot.busy.includes(editingId)) return;
                const invalid = validateDraft(draft);
                if (invalid !== undefined) {
                    this.patch({ draftError: invalid });
                    return;
                }

                let original = {};
                if (isNew) {
                    // 行 id 由用户可改，改错了会撞车或造出不可寻址的行，所以先本地拦一遍。
                    if (!SERVER_NAME.test(editingId)) {
                        this.patch({ draftError: this.t("badRowId") });
                        return;
                    }
                } else {
                    const row = this.snapshot.rows.find((item) => item.patchId === editingId);
                    if (row === undefined) {
                        this.patch({ draftError: this.t("rowGone") });
                        return;
                    }
                    original = row.config;
                }

                this.patch({ busy: [...this.snapshot.busy, editingId], draftError: null, notice: null });
                let result;
                try {
                    // 以原 config 为基底合并，避免丢弃表单未暴露的字段；新建时基底为空。
                    // 注释只在新建时提交：改写既有行不动块注释，避免影响同块的其他行。
                    result = await this.call("save", {
                        id: editingId,
                        config: draftToConfig(draft, original),
                        ...isNew ? { create: true, comment: draft.comment ?? "" } : {}
                    });
                } catch (error) {
                    const message = String(error?.message ?? error);
                    this.patch({ draftError: error?.status === 403 ? message : `传输失败：${message}` });
                    this.patch({ busy: this.snapshot.busy.filter((id) => id !== editingId) });
                    return;
                }
                if (result === null || result.ok !== true) {
                    this.patch({ draftError: this.detailOf(result) });
                    this.patch({ busy: this.snapshot.busy.filter((id) => id !== editingId) });
                    return;
                }
                this.patch({ busy: this.snapshot.busy.filter((id) => id !== editingId) });

                // Host 已确认运行时是否收敛。先读权威值，再据此给结论：
                // 没收敛就如实说明「只写进了文件」，而不是显示一个旧值还宣称已生效。
                const notice = result.value?.applied === false ? this.t("savedPending") : this.t("saved");
                if (isNew) {
                    // 队列为空说明是「新增服务器」按钮进来的单条新建，收尾与导入不同：
                    // 不能报「导入结束」，也不该继续打开下一条。
                    if (this.snapshot.queue.length === 0) {
                        this.patch({
                            editingId: null,
                            draft: null,
                            isNew: false,
                            rowIdTouched: false,
                            warnings: [],
                            notice: null
                        });
                        await this.load();
                        this.patch({ notice });
                        return;
                    }
                    this.patch({
                        savedCount: this.snapshot.savedCount + 1,
                        queueIndex: this.snapshot.queueIndex + 1,
                        editingId: null,
                        draft: null,
                        isNew: false,
                        rowIdTouched: false,
                        warnings: [],
                        notice
                    });
                    await this.load();
                    this.openQueued();
                    return;
                }
                this.patch({ editingId: null, draft: null, warnings: [], notice: null });
                await this.load();
                this.patch({ notice });
            }

            /**
             * 启停走官方 pluginManager —— 它已负责写 `disabled` 并处理热重载。
             * 注意它需要的是 Loader 树限定 id（`entryId`，形如 `include:mcp-x`），
             * 而不是 profile patch 行 id（`patchId`），两者不可混用。
             */
            async toggle(row) {
                if (row.entryId === undefined) {
                    this.patch({ error: "该行缺少 entryId，无法启停" });
                    return;
                }
                // 同 save：disabled 晚一拍，连点会并发写两次 disabled 状态。
                if (this.snapshot.busy.includes(row.patchId)) return;
                this.patch({ busy: [...this.snapshot.busy, row.patchId], notice: null });
                try {
                    const result = await this.ctx.remote.pluginManager.setPluginEnabled(row.entryId, !row.enabled);
                    if (result === null || result.ok !== true) {
                        const detail = result?.error ? `${result.error.code}: ${result.error.message}` : "unknown failure";
                        throw new Error(detail);
                    }
                    await this.load();
                } catch (error) {
                    this.patch({ error: String(error?.message ?? error) });
                } finally {
                    this.patch({ busy: this.snapshot.busy.filter((id) => id !== row.patchId) });
                }
            }
        }
        //#endregion

        //#region 视图
        function Tag(props) {
            return jsx("span", { style: { ...S.tag, ...(props.tone ?? {}) }, children: props.children });
        }

        function Field(props) {
            return jsxs("label", {
                style: S.field,
                children: [
                    jsx("span", { style: S.label, children: props.label }),
                    props.children,
                    props.hint ? jsx("span", { style: S.note, children: props.hint }) : null
                ]
            });
        }

        function TextField(props) {
            return jsxs(Field, {
                label: props.label,
                hint: props.hint,
                children: [jsx("input", {
                    type: "text",
                    value: props.value,
                    disabled: props.disabled,
                    spellCheck: false,
                    style: S.input,
                    onChange: (event) => {
                        props.onChange(event.target.value);
                    }
                })]
            });
        }

        function TextAreaField(props) {
            return jsxs(Field, {
                label: props.label,
                hint: props.hint,
                children: [jsx("textarea", {
                    value: props.value,
                    rows: props.rows ?? 3,
                    disabled: props.disabled,
                    spellCheck: false,
                    style: S.textarea,
                    onChange: (event) => {
                        props.onChange(event.target.value);
                    }
                })]
            });
        }

        function CheckField(props) {
            return jsxs("label", {
                style: S.checkboxRow,
                children: [
                    jsx("input", {
                        type: "checkbox",
                        checked: props.checked,
                        disabled: props.disabled,
                        onChange: (event) => {
                            props.onChange(event.target.checked);
                        }
                    }),
                    jsx("span", { children: props.label })
                ]
            });
        }

        /** 一行服务器卡片。 */
        function RowCard(props) {
            const { row, t, busy, locked } = props;
            return jsxs("li", {
                style: S.card,
                "data-mcp-row": row.patchId,
                children: [
                    jsxs("div", {
                        style: S.cardHead,
                        children: [
                            jsx("span", { style: S.name, children: row.serverName ?? row.patchId }),
                            row.enabled
                                ? jsx(Tag, { tone: { borderColor: "var(--dsw-alias-state-success-primary)", color: "var(--dsw-alias-state-success-primary)" }, children: t("enabled") })
                                : jsx(Tag, { tone: { borderColor: "var(--dsw-alias-state-error-primary)", color: "var(--dsw-alias-state-error-primary)" }, children: t("disabled") }),
                            jsx(Tag, { children: `${t("phase")}: ${row.state}` }),
                            jsx(Tag, { children: row.transport ?? "—" }),
                            jsx("span", { style: S.spacer }),
                            jsxs("div", {
                                style: S.actions,
                                children: [
                                    jsx("button", {
                                        type: "button",
                                        style: { ...S.button, opacity: busy ? 0.5 : 1 },
                                        disabled: busy || locked,
                                        onClick: () => {
                                            props.onEdit(row.patchId);
                                        },
                                        children: t("edit")
                                    }),
                                    // 按钮只表达动作；当前状态由左侧标签承载。
                                    jsx("button", {
                                        type: "button",
                                        role: "switch",
                                        "aria-checked": row.enabled,
                                        "aria-label": `${t("toggle")} ${row.serverName ?? row.patchId}`,
                                        title: locked ? t("readOnly") : undefined,
                                        disabled: busy || locked,
                                        onClick: () => {
                                            props.onToggle(row);
                                        },
                                        style: { ...S.button, opacity: locked || busy ? 0.5 : 1 },
                                        children: row.enabled ? t("disableAction") : t("enableAction")
                                    }),
                                    jsx("button", {
                                        type: "button",
                                        style: { ...S.button, opacity: busy ? 0.5 : 1 },
                                        disabled: busy,
                                        onClick: () => {
                                            props.onRemoveRequest(row);
                                        },
                                        children: t("remove")
                                    })
                                ]
                            })
                        ]
                    }),
                    jsx("p", { style: S.meta, children: jsx("code", { style: S.mono, children: row.target || "—" }) }),
                    jsx("p", { style: S.meta, children: `${t("toolCount")}: ${String(row.toolCount ?? 0)}` }),
                    locked ? jsx("p", { style: { ...S.meta, ...S.danger }, children: t("readOnly") }) : null,
                    // 删除前必须让用户看见「会一起删掉几行注释」——那些注释是手工文档。
                    props.confirming ? jsxs("div", {
                        style: S.warnBox,
                        children: [
                            jsx("span", { style: { ...S.meta, ...S.danger }, children: t("removeAsk") }),
                            jsx("p", {
                                style: { ...S.meta, ...S.danger },
                                children: `${props.comments} ${t("commentLines")}`
                            }),
                            jsx("p", { style: S.meta, children: t("removeNote") }),
                            jsxs("div", {
                                style: S.actions,
                                children: [
                                    jsx("button", {
                                        type: "button",
                                        style: { ...S.button, ...S.danger },
                                        disabled: busy,
                                        onClick: () => { props.onRemoveConfirm(); },
                                        children: t("removeYes")
                                    }),
                                    jsx("button", {
                                        type: "button",
                                        style: S.button,
                                        disabled: busy,
                                        onClick: () => { props.onRemoveCancel(); },
                                        children: t("removeNo")
                                    })
                                ]
                            })
                        ]
                    }) : null
                ]
            });
        }

        /**
         * 传输方式与连接字段。
         *
         * 全局编辑页与项目页的「新增服务器」共用这一套字段，避免两处各写一份后
         * 出现「全局能填 env、项目却忘了」这类漂移。行 id、注释等只属于 profile
         * patch 的字段不在这里。
         */
        function ConfigFields(props) {
            const { draft, t, busy } = props;
            const stdio = draft.transport === "stdio";
            return jsxs(React.Fragment, {
                children: [
                    jsxs(Field, {
                        label: t("transport"),
                        children: [jsxs("select", {
                            value: draft.transport,
                            disabled: busy,
                            style: S.input,
                            onChange: (event) => {
                                props.onTransport(event.target.value);
                            },
                            children: [
                                jsx("option", { value: "streamable-http", children: "streamable-http" }),
                                jsx("option", { value: "stdio", children: "stdio" })
                            ]
                        })]
                    }),
                    jsx(TextField, {
                        label: t("serverName"),
                        value: draft.serverName,
                        disabled: busy || props.nameLocked === true,
                        hint: props.nameLocked === true ? t("serverNameLocked") : undefined,
                        onChange: (value) => {
                            props.onField("serverName", value);
                        }
                    }),
                    stdio
                        ? jsx(React.Fragment, {
                            children: [
                                jsx(TextField, {
                                    label: t("command"),
                                    value: draft.command,
                                    disabled: busy,
                                    onChange: (value) => {
                                        props.onField("command", value);
                                    }
                                }),
                                jsx(TextAreaField, {
                                    label: t("args"),
                                    value: draft.args,
                                    disabled: busy,
                                    onChange: (value) => {
                                        props.onField("args", value);
                                    }
                                }),
                                jsx(TextAreaField, {
                                    label: "env",
                                    value: draft.env,
                                    disabled: busy,
                                    rows: 2,
                                    hint: "KEY=VALUE",
                                    onChange: (value) => {
                                        props.onField("env", value);
                                    }
                                }),
                                jsx(TextField, {
                                    label: t("cwd"),
                                    value: draft.cwd,
                                    disabled: busy,
                                    onChange: (value) => {
                                        props.onField("cwd", value);
                                    }
                                })
                            ]
                        })
                        : jsxs(React.Fragment, {
                            children: [
                                jsx(TextField, {
                                    label: t("url"),
                                    value: draft.url,
                                    disabled: busy,
                                    onChange: (value) => {
                                        props.onField("url", value);
                                    }
                                }),
                                jsx(TextAreaField, {
                                    label: t("headers"),
                                    value: draft.headers,
                                    disabled: busy,
                                    rows: 2,
                                    hint: "Authorization=Bearer …",
                                    onChange: (value) => {
                                        props.onField("headers", value);
                                    }
                                })
                            ]
                        }),
                    jsx(TextField, {
                        label: t("timeout"),
                        value: draft.toolCallTimeoutMs,
                        disabled: busy,
                        onChange: (value) => {
                            props.onField("toolCallTimeoutMs", value);
                        }
                    }),
                    jsxs("div", {
                        style: { display: "flex", gap: "14px", flexWrap: "wrap" },
                        children: [
                            jsx(CheckField, {
                                label: t("failOnStartup"),
                                checked: draft.failOnStartupError === true,
                                disabled: busy,
                                onChange: (value) => {
                                    props.onField("failOnStartupError", value);
                                }
                            }),
                            jsx(CheckField, {
                                label: t("reconnect"),
                                checked: draft.reconnect === true,
                                disabled: busy,
                                onChange: (value) => {
                                    props.onField("reconnect", value);
                                }
                            })
                        ]
                    })
                ]
            });
        }

        /** 编辑表单。 */
        function EditForm(props) {
            const { row, draft, t, busy, draftError, isNew, warnings, skipping } = props;
            return jsxs("div", {
                style: { ...S.card, gap: "10px" },
                "data-mcp-editor": row.patchId,
                children: [
                    jsxs("div", {
                        style: S.cardHead,
                        children: [
                            // 新建态还没有名字可展示，标题直说「新增服务器」；
                            // 既有行展示 serverName，未填时退回 patch 行 id。
                            jsx("span", {
                                style: S.name,
                                children: isNew ? t("addTitle") : (draft.serverName || row.patchId)
                            }),
                            isNew ? null : jsx(Tag, { children: t("dirty") }),
                            jsx("span", { style: S.spacer }),
                            jsx("button", {
                                type: "button",
                                style: S.button,
                                disabled: busy,
                                onClick: () => {
                                    props.onCancel();
                                },
                                children: t("back")
                            })
                        ]
                    }),
                    jsx(ConfigFields, {
                        t,
                        draft,
                        busy,
                        onTransport: props.onTransport,
                        onField: props.onField
                    }),
                    // 新建态的行 id 由用户可改：不合规会造出撞车或不可寻址的行，所以
                    // 本地先拦一道，Host 侧还会再按「全局唯一」校验一次。
                    isNew ? jsxs(Field, {
                        label: t("rowIdLabel"),
                        children: [jsx("input", {
                            type: "text",
                            value: row.patchId,
                            disabled: busy,
                            style: S.input,
                            onChange: (event) => {
                                props.onRowId(event.target.value);
                            }
                        })]
                    }) : null,
                    // 注释也只在新建时可写：它落在 insert 块上方，既有行的块可能还服务
                    // 别的行，改写会波及邻居，因此保存时 Host 也只在 create 分支使用它。
                    isNew ? jsx(TextAreaField, {
                        label: t("comment"),
                        value: draft.comment ?? "",
                        disabled: busy,
                        rows: 2,
                        hint: t("commentHint"),
                        onChange: (value) => {
                            props.onField("comment", value);
                        }
                    }) : null,
                    // JSON 转换必然有推断和取舍，逐条摆出来让用户保存前先看到。
                    warnings.length > 0 ? jsxs("div", {
                        style: S.warnBox,
                        children: [
                            jsx("span", { style: { ...S.meta, ...S.danger }, children: t("warningsLabel") }),
                            ...warnings.map((warning, index) => jsx("p", {
                                key: `warning-${index}`,
                                style: { ...S.meta, ...S.danger },
                                children: `· ${warning}`
                            }))
                        ]
                    }) : null,
                    draftError ? jsx("p", { style: { ...S.meta, ...S.danger }, children: draftError }) : null,
                    jsxs("div", {
                        style: S.actions,
                        children: [
                            jsx("button", {
                                type: "button",
                                style: { ...S.button, ...S.primary },
                                disabled: busy,
                                onClick: () => {
                                    props.onSave();
                                },
                                children: busy ? t("saving") : t("save")
                            }),
                            jsx("button", {
                                type: "button",
                                style: S.button,
                                disabled: busy,
                                onClick: () => {
                                    // 导入队列里这个按钮是「跳过此条」而不是放弃整次编辑。
                                    if (skipping) props.onSkip();
                                    else props.onCancel();
                                },
                                children: skipping ? t("skip") : t("discard")
                            }),
                            jsx("span", {
                                style: S.note,
                                children: t("notEditable")
                            })
                        ]
                    })
                ]
            });
        }

        /**
         * 项目页的「新增服务器」表单。
         *
         * 字段与全局编辑页共用 ConfigFields；区别在于落点：全局写 profile patch，
         * 这里先合并进 `.dsh/mcp.yml` 的编辑器文本，再整份保存。
         */
        function ProjectAddForm(props) {
            const { t, draft, busy, error } = props;
            return jsxs("div", {
                style: { ...S.card, gap: "10px" },
                "data-mcp-project-add": true,
                children: [
                    jsxs("div", {
                        style: S.cardHead,
                        children: [
                            jsx("span", { style: S.name, children: t("addTitle") }),
                            jsx("span", { style: S.spacer })
                        ]
                    }),
                    jsx(ConfigFields, {
                        t,
                        draft,
                        busy,
                        onTransport: props.onTransport,
                        onField: props.onField
                    }),
                    jsx("p", { style: S.note, children: t("projectAddHint") }),
                    error ? jsx("p", { style: { ...S.meta, ...S.danger }, children: error }) : null,
                    jsxs("div", {
                        style: S.actions,
                        children: [
                            jsx("button", {
                                type: "button",
                                style: { ...S.button, ...S.primary },
                                disabled: busy,
                                onClick: () => {
                                    props.onSave();
                                },
                                children: busy ? t("saving") : t("save")
                            }),
                            jsx("button", {
                                type: "button",
                                style: S.button,
                                disabled: busy,
                                onClick: () => {
                                    props.onCancel();
                                },
                                children: t("cancel")
                            })
                        ]
                    })
                ]
            });
        }

        /** 项目页的一条服务器卡片：编辑、启停、删除都在卡片内完成。 */
        function ProjectRowCard(props) {
            const { row, t, busy, overridesGlobal } = props;
            return jsxs("li", {
                style: S.card,
                "data-mcp-project-row": row.serverName,
                children: [
                    jsxs("div", {
                        style: S.cardHead,
                        children: [
                            jsx("span", { style: S.name, children: row.serverName }),
                            row.enabled
                                ? jsx(Tag, { tone: { borderColor: "var(--dsw-alias-state-success-primary)", color: "var(--dsw-alias-state-success-primary)" }, children: t("enabled") })
                                : jsx(Tag, { tone: { borderColor: "var(--dsw-alias-state-error-primary)", color: "var(--dsw-alias-state-error-primary)" }, children: t("disabled") }),
                            jsx(Tag, { children: row.transport ?? "—" }),
                            // 项目优先于全局：同名全局服务器存在时明确标出来，
                            // 否则用户看到两份配置会以为其中一份没生效。
                            overridesGlobal ? jsx(Tag, { children: t("projectOverrides") }) : null,
                            jsx("span", { style: S.spacer }),
                            jsxs("div", {
                                style: S.actions,
                                children: [
                                    jsx("button", {
                                        type: "button",
                                        style: { ...S.button, opacity: busy ? 0.5 : 1 },
                                        disabled: busy,
                                        onClick: () => {
                                            props.onEdit(row.serverName);
                                        },
                                        children: t("edit")
                                    }),
                                    jsx("button", {
                                        type: "button",
                                        role: "switch",
                                        "aria-checked": row.enabled,
                                        "aria-label": `${t("toggle")} ${row.serverName}`,
                                        disabled: busy,
                                        onClick: () => {
                                            props.onToggle(row);
                                        },
                                        style: { ...S.button, opacity: busy ? 0.5 : 1 },
                                        children: row.enabled ? t("disableAction") : t("enableAction")
                                    }),
                                    jsx("button", {
                                        type: "button",
                                        style: { ...S.button, opacity: busy ? 0.5 : 1 },
                                        disabled: busy,
                                        onClick: () => {
                                            props.onRemoveRequest(row);
                                        },
                                        children: t("remove")
                                    })
                                ]
                            })
                        ]
                    }),
                    jsx("p", { style: S.meta, children: jsx("code", { style: S.mono, children: row.target || "—" }) }),
                    row.enabled ? null : jsx("p", { style: S.meta, children: t("projectDisabledNote") }),
                    props.confirming ? jsxs("div", {
                        style: S.warnBox,
                        children: [
                            jsx("span", { style: { ...S.meta, ...S.danger }, children: t("projectRemoveAsk") }),
                            jsx("p", { style: { ...S.meta, ...S.danger }, children: `${props.comments} ${t("commentLines")}` }),
                            jsx("p", { style: S.meta, children: t("projectRemoveNote") }),
                            jsxs("div", {
                                style: S.actions,
                                children: [
                                    jsx("button", {
                                        type: "button",
                                        style: { ...S.button, ...S.danger },
                                        disabled: busy,
                                        onClick: () => { props.onRemoveConfirm(); },
                                        children: t("removeYes")
                                    }),
                                    jsx("button", {
                                        type: "button",
                                        style: S.button,
                                        disabled: busy,
                                        onClick: () => { props.onRemoveCancel(); },
                                        children: t("removeNo")
                                    })
                                ]
                            })
                        ]
                    }) : null
                ]
            });
        }

        /**
         * 项目页的编辑表单。
         *
         * 与全局的 EditForm 分开：项目条目的 serverName 就是 `servers` 的键，
         * 改名等于删除重建，所以名称字段锁定；也没有 patch 行 id 与块注释这两个
         * 只属于 profile patch 的概念。
         */
        function ProjectEditForm(props) {
            const { t, draft, busy, error } = props;
            return jsxs("div", {
                style: { ...S.card, gap: "10px" },
                "data-mcp-project-edit": draft.serverName,
                children: [
                    jsxs("div", {
                        style: S.cardHead,
                        children: [
                            jsx("span", { style: S.name, children: draft.serverName }),
                            jsx(Tag, { children: t("dirty") }),
                            jsx("span", { style: S.spacer }),
                            jsx("button", {
                                type: "button",
                                style: S.button,
                                disabled: busy,
                                onClick: () => { props.onCancel(); },
                                children: t("back")
                            })
                        ]
                    }),
                    jsx(ConfigFields, {
                        t,
                        draft,
                        busy,
                        nameLocked: true,
                        onTransport: props.onTransport,
                        onField: props.onField
                    }),
                    error ? jsx("p", { style: { ...S.meta, ...S.danger }, children: error }) : null,
                    jsxs("div", {
                        style: S.actions,
                        children: [
                            jsx("button", {
                                type: "button",
                                style: { ...S.button, ...S.primary },
                                disabled: busy,
                                onClick: () => { props.onSave(); },
                                children: busy ? t("saving") : t("save")
                            }),
                            jsx("button", {
                                type: "button",
                                style: S.button,
                                disabled: busy,
                                onClick: () => { props.onCancel(); },
                                children: t("discard")
                            }),
                            jsx("span", { style: S.note, children: t("projectToggleNote") })
                        ]
                    })
                ]
            });
        }

        /** 「全局」tab：profile 级 MCP 行（原列表 + 编辑页，逻辑未变）。 */
        function GlobalPanel(props) {
            const { t } = props;
            const state = props.state;

            if (state.status === "loading" && state.rows.length === 0) {
                return jsx("p", { style: S.meta, children: t("loading") });
            }

            // 新建态的行还不存在于 state.rows 里，造一个合成行让编辑页照常渲染；
            // 否则编辑页会因为找不到 row 而退化成显示列表。
            const editing = state.editingId === null
                ? null
                : state.isNew
                    ? { patchId: state.editingId, serverName: "", config: {} }
                    : state.rows.find((row) => row.patchId === state.editingId) ?? null;

            return jsxs("div", {
                // 保留 S.page：面板内部的间距（12px gap）由它提供，外层容器只管 tab 与面板之间。
                style: S.page,
                children: [
                    jsxs("div", {
                        style: S.cardHead,
                        children: [
                            jsx("h2", { style: S.h2, children: t("title") }),
                            jsx("span", { style: S.spacer }),
                            // 新增入口只在列表页出现；编辑页里再放一个只会让人点错。
                            editing === null
                                ? jsx("button", {
                                    type: "button",
                                    style: { ...S.button, ...S.primary },
                                    onClick: () => { props.onCreate(); },
                                    children: t("add")
                                })
                                : null
                        ]
                    }),
                    jsx("p", { style: S.intro, children: t("intro") }),
                    state.error !== null
                        ? jsxs("div", {
                            style: S.actions,
                            children: [
                                jsx("span", { style: { ...S.meta, ...S.danger }, children: `${t("errorLabel")}: ${state.error}` }),
                                jsx("button", { type: "button", style: S.button, onClick: () => { props.reload(); }, children: t("retry") })
                            ]
                        })
                        : null,
                    state.notice !== null ? jsx("p", { style: { ...S.meta, ...S.ok }, children: state.notice }) : null,
                    editing !== null && state.draft !== null
                        ? jsx(EditForm, {
                            row: editing,
                            draft: state.draft,
                            t,
                            // 行对象上是 `patchId`；这里曾误写 `editing.id`，导致
                            // busy 恒为 false、保存按钮从不置灰（连点的根源之一）。
                            busy: state.busy.includes(editing.patchId),
                            draftError: state.draftError,
                            isNew: state.isNew,
                            warnings: state.warnings,
                            skipping: state.queue.length > 0,
                            onField: (field, value) => { props.onField(field, value); },
                            onTransport: (value) => { props.onTransport(value); },
                            onRowId: (value) => { props.onRowId(value); },
                            onSave: () => { props.onSave(); },
                            onCancel: () => { props.onCancel(); },
                            onSkip: () => { props.onSkip(); }
                        })
                        : jsxs(React.Fragment, {
                            children: [
                                state.rows.length === 0
                                    ? jsx("p", { style: S.meta, children: t("empty") })
                                    : jsx("ul", {
                                        style: S.list,
                                        children: state.rows.map((row) => jsx(RowCard, {
                                            row,
                                            t,
                                            busy: state.busy.includes(row.patchId),
                                            // 只有拿不到 Loader 树限定 id 时才无法启停。
                                            locked: typeof row.entryId !== "string" || row.entryId.length === 0,
                                            confirming: state.removeTarget === row.patchId,
                                            comments: state.removeComments,
                                            onEdit: (id) => { props.onEdit(id); },
                                            onToggle: (target) => { props.onToggle(target); },
                                            onRemoveRequest: (target) => { props.onRemoveRequest(target); },
                                            onRemoveConfirm: () => { props.onRemoveConfirm(); },
                                            onRemoveCancel: () => { props.onRemoveCancel(); }
                                        }, row.patchId))
                                    }),
                                jsxs("div", {
                                    style: S.importBox,
                                    children: [
                                        jsx("span", { style: { ...S.meta, fontWeight: 600 }, children: t("importTitle") }),
                                        jsx("textarea", {
                                            style: S.textarea,
                                            placeholder: t("importPlaceholder"),
                                            value: state.importText,
                                            onChange: (event) => { props.onImportText(event.target.value); }
                                        }),
                                        jsxs("div", {
                                            style: S.actions,
                                            children: [
                                                jsx("button", {
                                                    type: "button",
                                                    style: { ...S.button, ...S.primary },
                                                    disabled: state.importText.trim().length === 0,
                                                    onClick: () => { props.onParseImport(); },
                                                    children: t("importParse")
                                                }),
                                                jsx("span", { style: S.note, children: t("importHint") })
                                            ]
                                        }),
                                        state.importError !== null
                                            ? jsx("p", { style: { ...S.meta, ...S.danger }, children: state.importError })
                                            : null
                                    ]
                                }),
                                jsx("p", { style: S.note, children: t("addHint") }),
                                jsx("p", { style: S.note, children: t("note") })
                            ]
                        })
                ]
            });
        }
        //#endregion

        /**
         * 「项目」tab：选一个工作区，按卡片管理该项目的 `.dsh/mcp.yml`。
         *
         * 卡片是主视图：每条服务器一张卡，可以编辑、启停、删除，动作直接落盘。
         * 源码编辑器放在页面最下方且默认折叠——项目文件里常有人工注释与
         * `disableGlobal`，那些内容仍然需要手改入口，但不该是日常入口。
         */
        function ProjectPanel(props) {
            const { t } = props;
            // 槽位注入的快照来自别的 UI 包；拿不到 items 时退化成空列表，不抛异常。
            const workspaces = props.useWorkspaces((state) => state.items) ?? [];
            // 全局行只用来标注「覆盖全局」；拿不到就当没有，不影响卡片可用性。
            // 只算启用中的全局行：全局本来就没挂载时，项目条目只是唯一来源而非覆盖。
            const globalNames = new Set((props.globalRows ?? [])
                .filter((row) => row.enabled !== false)
                .map((row) => row.serverName));
            const [selected, setSelected] = React.useState(null);
            const [state, setState] = React.useState({
                status: "idle",
                project: null,
                text: "",
                error: null,
                notice: null,
                /** 正在进行的动作：serverName / "add" / "source" / null。 */
                busy: null,
                /** 正在编辑的项目条目。 */
                editing: null,
                editDraft: null,
                editError: null,
                /** 是否正在填写「新增服务器」表单。 */
                adding: false,
                addDraft: null,
                addError: null,
                /** 待确认删除的 serverName 与预检出来的注释行数。 */
                removeTarget: null,
                removeComments: 0,
                /** 源码区是否展开（默认折叠，放在页面最下方）。 */
                sourceOpen: false,
                importText: "",
                importError: null,
                warnings: [],
                overwritten: []
            });

            // 文案随语言切换而变，用 ref 取最新值，好让 load 保持稳定身份：
            // 否则 useEffect 会因为 load 换了身份而反复重新读取。
            const tRef = React.useRef(t);
            tRef.current = t;

            // 默认选第一个工作区；用户手选之后以手选为准。
            const path = selected ?? workspaces[0]?.path ?? null;
            // 快速切换工作区时，晚到的响应不能覆盖新的选择。
            const requested = React.useRef(null);

            const load = React.useCallback(async (target) => {
                requested.current = target;
                setState((current) => ({ ...current, status: "loading", error: null, notice: null }));
                let result;
                try {
                    result = await callApi("project/read", { cwd: target });
                } catch (error) {
                    if (requested.current !== target) return;
                    setState((current) => ({ ...current, status: "error", error: callErrorText(error, tRef.current) }));
                    return;
                }
                if (requested.current !== target) return;
                if (result?.ok !== true) {
                    setState((current) => ({ ...current, status: "error", error: detailText(result) }));
                    return;
                }
                setState((current) => ({
                    ...current,
                    status: "ready",
                    project: result.value,
                    text: result.value?.text ?? "",
                    error: null,
                    warnings: [],
                    overwritten: [],
                    // 换项目/重新读取后，旧项目的编辑态与待删除态都不再成立。
                    editing: null,
                    editDraft: null,
                    editError: null,
                    adding: false,
                    addDraft: null,
                    addError: null,
                    removeTarget: null,
                    removeComments: 0
                }));
            }, []);

            React.useEffect(() => {
                if (path !== null) void load(path);
            }, [path, load]);

            /** Host 的失败结果 → 可读消息（问题清单优先，一条都不漏）。 */
            const failureText = (result) => {
                const problems = result?.error?.details?.problems;
                return Array.isArray(problems) && problems.length > 0 ? problems.join("；") : detailText(result);
            };

            /**
             * 结构化操作成功后的统一收尾。
             *
             * Host 直接落盘并回传新视图，因此这里把编辑器文本也换成服务端那份：
             * 否则卡片变了、源码还是旧的，下一次操作会把旧内容又写回去。
             */
            const applied = (view, notice) => {
                setState((current) => ({
                    ...current,
                    busy: null,
                    status: "ready",
                    project: view ?? current.project,
                    text: view?.text ?? current.text,
                    error: null,
                    notice,
                    editing: null,
                    editDraft: null,
                    editError: null,
                    adding: false,
                    addDraft: null,
                    addError: null,
                    removeTarget: null,
                    removeComments: 0
                }));
            };

            /** 保存源码编辑器里的整份配置。 */
            const saveSource = async () => {
                if (path === null || state.busy !== null) return;
                setState((current) => ({ ...current, busy: "source", error: null, notice: null }));
                let result;
                try {
                    result = await callApi("project/save", { cwd: path, text: state.text });
                } catch (error) {
                    setState((current) => ({ ...current, busy: null, error: callErrorText(error, tRef.current) }));
                    return;
                }
                if (result?.ok !== true) {
                    setState((current) => ({ ...current, busy: null, error: failureText(result) }));
                    return;
                }
                setState((current) => ({
                    ...current,
                    busy: null,
                    status: "ready",
                    project: result.value,
                    text: result.value?.text ?? current.text,
                    notice: tRef.current("projectSaved"),
                    error: null
                }));
            };

            /** 打开「新增服务器」表单：空草稿，字段与全局编辑页一致。 */
            const startAdd = () => {
                setState((current) => ({
                    ...current,
                    adding: true,
                    addDraft: configToDraft({}),
                    addError: null,
                    editing: null,
                    editDraft: null,
                    editError: null,
                    notice: null
                }));
            };

            /** 更新新增表单的单个字段。 */
            const updateAdd = (field, value) => {
                setState((current) => current.addDraft === null
                    ? current
                    : { ...current, addDraft: { ...current.addDraft, [field]: value }, addError: null });
            };

            const cancelAdd = () => {
                setState((current) => ({ ...current, adding: false, addDraft: null, addError: null }));
            };

            /**
             * 保存新增的一条服务器。
             *
             * 合并基底是编辑器里的文本：用户可能在源码里改了还没保存，卡片操作
             * 不该把那份改动冲掉。Host 侧按同一份文本校验同名条目，因此手写进
             * 源码但还没保存的同名条目也会被拦下。
             */
            const saveAdd = async () => {
                if (path === null || state.addDraft === null || state.busy !== null) return;
                const draft = state.addDraft;
                const invalid = validateDraft(draft);
                if (invalid !== undefined) {
                    setState((current) => ({ ...current, addError: invalid }));
                    return;
                }
                const serverName = draft.serverName.trim();
                if ((state.project?.servers ?? []).some((item) => item.serverName === serverName)) {
                    setState((current) => ({ ...current, addError: `serverName ${JSON.stringify(serverName)} 已存在于该项目的 servers 中` }));
                    return;
                }
                // 项目配置里服务器名就是 servers 的键，条目内不需要重复写 serverName。
                const config = draftToConfig(draft, {});
                delete config.serverName;

                setState((current) => ({ ...current, busy: "add", addError: null, error: null, notice: null }));
                let result;
                try {
                    result = await callApi("project/update", { cwd: path, text: state.text, serverName, config, create: true });
                } catch (error) {
                    setState((current) => ({ ...current, busy: null, addError: callErrorText(error, tRef.current) }));
                    return;
                }
                if (result?.ok !== true) {
                    const message = result?.error?.code === "project/server-exists"
                        ? `编辑器里已存在同名条目：${serverName}，请换个 serverName 或先删掉那条`
                        : failureText(result);
                    setState((current) => ({ ...current, busy: null, addError: message }));
                    return;
                }
                applied(result.value, tRef.current("projectSaved"));
            };

            /** 打开某条服务器的编辑表单。 */
            const startEdit = (serverName) => {
                const row = (state.project?.servers ?? []).find((item) => item.serverName === serverName);
                if (row === undefined) return;
                setState((current) => ({
                    ...current,
                    editing: serverName,
                    // 带上 serverName 作为基底：它是映射键，不放在条目里，改名等于重建。
                    editDraft: configToDraft({ ...row.config, serverName: row.serverName }),
                    editError: null,
                    adding: false,
                    addDraft: null,
                    addError: null,
                    notice: null
                }));
            };

            const updateEdit = (field, value) => {
                setState((current) => current.editDraft === null
                    ? current
                    : { ...current, editDraft: { ...current.editDraft, [field]: value }, editError: null });
            };

            const cancelEdit = () => {
                setState((current) => ({ ...current, editing: null, editDraft: null, editError: null }));
            };

            /** 保存对某条服务器的修改。 */
            const saveEdit = async () => {
                if (path === null || state.editing === null || state.editDraft === null || state.busy !== null) return;
                const row = (state.project?.servers ?? []).find((item) => item.serverName === state.editing);
                if (row === undefined) {
                    setState((current) => ({ ...current, editError: tRef.current("rowGone") }));
                    return;
                }
                const draft = { ...state.editDraft, serverName: row.serverName };
                const invalid = validateDraft(draft);
                if (invalid !== undefined) {
                    setState((current) => ({ ...current, editError: invalid }));
                    return;
                }
                // 以原始配置为基底：表单没暴露的字段（maxInstructionBytes 等）不该被丢掉。
                const config = draftToConfig(draft, { ...row.config, serverName: row.serverName });
                delete config.serverName;

                setState((current) => ({ ...current, busy: row.serverName, editError: null, error: null, notice: null }));
                let result;
                try {
                    result = await callApi("project/update", { cwd: path, text: state.text, serverName: row.serverName, config, create: false });
                } catch (error) {
                    setState((current) => ({ ...current, busy: null, editError: callErrorText(error, tRef.current) }));
                    return;
                }
                if (result?.ok !== true) {
                    setState((current) => ({ ...current, busy: null, editError: failureText(result) }));
                    return;
                }
                applied(result.value, tRef.current("projectSaved"));
            };

            /** 启用/停用一个条目：只改 `disabled` 标记，配置本身不动。 */
            const toggle = async (row) => {
                if (path === null || state.busy !== null) return;
                setState((current) => ({ ...current, busy: row.serverName, error: null, notice: null }));
                let result;
                try {
                    result = await callApi("project/toggle", {
                        cwd: path,
                        text: state.text,
                        serverName: row.serverName,
                        enabled: !row.enabled
                    });
                } catch (error) {
                    setState((current) => ({ ...current, busy: null, error: callErrorText(error, tRef.current) }));
                    return;
                }
                if (result?.ok !== true) {
                    setState((current) => ({ ...current, busy: null, error: failureText(result) }));
                    return;
                }
                applied(result.value, row.enabled ? tRef.current("projectDisabledSaved") : tRef.current("projectEnabledSaved"));
            };

            /** 删除第一步：只预检「会一起删掉几行注释」，让用户先确认。 */
            const removeRequest = async (row) => {
                if (path === null || state.busy !== null) return;
                setState((current) => ({ ...current, busy: row.serverName, error: null, notice: null }));
                let result;
                try {
                    result = await callApi("project/remove", {
                        cwd: path,
                        text: state.text,
                        serverName: row.serverName,
                        confirm: false
                    });
                } catch (error) {
                    setState((current) => ({ ...current, busy: null, error: callErrorText(error, tRef.current) }));
                    return;
                }
                if (result?.ok !== true) {
                    setState((current) => ({ ...current, busy: null, error: failureText(result) }));
                    return;
                }
                setState((current) => ({
                    ...current,
                    busy: null,
                    removeTarget: row.serverName,
                    removeComments: result.value?.comments ?? 0
                }));
            };

            const removeCancel = () => {
                setState((current) => ({ ...current, removeTarget: null, removeComments: 0 }));
            };

            /** 删除第二步：确认后落盘，并把原文备份到同目录。 */
            const removeConfirm = async () => {
                const serverName = state.removeTarget;
                if (path === null || serverName === null || state.busy !== null) return;
                setState((current) => ({ ...current, busy: serverName, error: null, notice: null }));
                let result;
                try {
                    result = await callApi("project/remove", {
                        cwd: path,
                        text: state.text,
                        serverName,
                        confirm: true
                    });
                } catch (error) {
                    setState((current) => ({ ...current, busy: null, error: callErrorText(error, tRef.current) }));
                    return;
                }
                if (result?.ok !== true) {
                    setState((current) => ({ ...current, busy: null, removeTarget: null, error: failureText(result) }));
                    return;
                }
                applied(result.value?.view, `${tRef.current("projectRemoved")}${serverName}`);
            };

            /** 把粘贴的 `.mcp.json` 转成配置并合并进源码文本（不落盘）。 */
            const convert = async () => {
                if (path === null || state.busy !== null) return;
                const parsed = parseMcpServers(state.importText);
                if (parsed.error !== undefined) {
                    setState((current) => ({ ...current, importError: parsed.error }));
                    return;
                }
                const servers = {};
                for (const candidate of parsed.candidates) servers[candidate.serverName] = candidate.config;
                let result;
                try {
                    // 带上编辑器里的文本：用户可能刚改过还没保存，用磁盘版本合并会把
                    // 这些改动冲掉。
                    result = await callApi("project/merge", { cwd: path, text: state.text, servers });
                } catch (error) {
                    setState((current) => ({ ...current, importError: callErrorText(error, tRef.current) }));
                    return;
                }
                if (result?.ok !== true) {
                    setState((current) => ({ ...current, importError: failureText(result) }));
                    return;
                }
                setState((current) => ({
                    ...current,
                    text: result.value?.text ?? current.text,
                    importError: null,
                    warnings: parsed.candidates.flatMap((candidate) =>
                        candidate.warnings.map((text) => `${candidate.serverName}: ${text}`)),
                    overwritten: result.value?.overwritten ?? []
                }));
            };

            const project = state.project;
            const servers = project?.servers ?? [];
            const editing = state.editing === null
                ? null
                : servers.find((item) => item.serverName === state.editing) ?? null;
            // 源码里改了还没保存：卡片仍是上一份已保存的视图，提示用户卡片操作会一并写盘。
            const dirty = project !== null && state.text !== project.text;
            const showCards = !state.adding && !(state.editing !== null && state.editDraft !== null && editing !== null);

            return jsxs("div", {
                style: S.page,
                "data-mcp-project": true,
                children: [
                    jsxs("div", {
                        style: S.cardHead,
                        children: [
                            jsx("h2", { style: S.h2, children: t("tabProject") }),
                            jsx("span", { style: S.spacer }),
                            // 与全局一致：列表态给入口，表单打开后收起，避免重复点击。
                            showCards
                                ? jsx("button", {
                                    type: "button",
                                    style: { ...S.button, ...S.primary },
                                    // 没读到配置时没有落点，别让用户打开一个保存不了的表单。
                                    disabled: path === null || project === null,
                                    onClick: () => {
                                        startAdd();
                                    },
                                    children: t("add")
                                })
                                : null,
                            jsx("button", {
                                type: "button",
                                style: S.button,
                                disabled: path === null,
                                onClick: () => {
                                    if (path !== null) void load(path);
                                },
                                children: t("projectReload")
                            })
                        ]
                    }),
                    jsx("p", { style: S.intro, children: t("projectIntro") }),
                    workspaces.length === 0
                        ? jsx("p", { style: S.meta, children: t("noWorkspace") })
                        : jsx("select", {
                            style: { ...S.input, width: "auto", maxWidth: "420px" },
                            value: path ?? "",
                            onChange: (event) => {
                                setSelected(event.target.value);
                            },
                            children: workspaces.map((item) => jsx("option", {
                                value: item.path,
                                children: item.title ? `${item.title} — ${item.path}` : item.path
                            }, item.path))
                        }),
                    state.status === "loading" && project === null
                        ? jsx("p", { style: S.meta, children: t("projectLoading") })
                        : null,
                    // 错误与提示必须画在「有没有读到配置」之外：读取失败时 project 是 null，
                    // 若把它们放进下面的分支，用户只会看到一个空面板而不知道发生了什么。
                    state.notice !== null
                        ? jsx("p", { style: { ...S.meta, ...S.ok }, children: state.notice })
                        : null,
                    state.error !== null
                        ? jsx("p", { style: { ...S.meta, ...S.danger }, children: `${t("errorLabel")}: ${state.error}` })
                        : null,
                    project === null
                        ? null
                        : jsxs(React.Fragment, {
                            children: [
                                jsxs("div", {
                                    style: S.pathRow,
                                    children: [
                                        jsxs("span", {
                                            style: S.meta,
                                            children: [
                                                `${t("projectFile")}: `,
                                                jsx("span", { style: S.mono, children: project.filename }),
                                                project.exists ? "" : ` — ${t("projectMissing")}`
                                            ]
                                        }),
                                        project.root === path
                                            ? null
                                            : jsx("span", { style: S.meta, children: `${t("projectRoot")}: ${project.root}` }),
                                        jsx("span", {
                                            style: S.meta,
                                            children: `${servers.length} ${t("projectServers")}`
                                        }),
                                        project.disableGlobal.length === 0
                                            ? null
                                            : jsx("span", {
                                                style: S.meta,
                                                children: `${t("projectDisabled")}: ${project.disableGlobal.join("、")}`
                                            })
                                    ]
                                }),
                                project.problems.length === 0
                                    ? null
                                    : jsxs("div", {
                                        style: S.warnBox,
                                        children: [
                                            jsx("span", { style: { ...S.meta, ...S.danger }, children: t("projectProblems") }),
                                            ...project.problems.map((problem) => jsx("span", {
                                                style: { ...S.meta, ...S.danger },
                                                children: problem
                                            }, problem))
                                        ]
                                    }),
                                state.adding && state.addDraft !== null
                                    ? jsx(ProjectAddForm, {
                                        t,
                                        draft: state.addDraft,
                                        busy: state.busy === "add",
                                        error: state.addError,
                                        onField: (field, value) => {
                                            updateAdd(field, value);
                                        },
                                        onTransport: (value) => {
                                            updateAdd("transport", value);
                                        },
                                        onSave: () => {
                                            void saveAdd();
                                        },
                                        onCancel: () => {
                                            cancelAdd();
                                        }
                                    })
                                    : state.editing !== null && state.editDraft !== null && editing !== null
                                        ? jsx(ProjectEditForm, {
                                            t,
                                            draft: state.editDraft,
                                            busy: state.busy === editing.serverName,
                                            error: state.editError,
                                            onField: (field, value) => {
                                                updateEdit(field, value);
                                            },
                                            onTransport: (value) => {
                                                updateEdit("transport", value);
                                            },
                                            onSave: () => {
                                                void saveEdit();
                                            },
                                            onCancel: () => {
                                                cancelEdit();
                                            }
                                        })
                                        : jsxs(React.Fragment, {
                                            children: [
                                                servers.length === 0
                                                    ? jsx("p", { style: S.meta, children: t("projectEmptyServers") })
                                                    : jsx("ul", {
                                                        style: S.list,
                                                        children: servers.map((row) => jsx(ProjectRowCard, {
                                                            row,
                                                            t,
                                                            busy: state.busy === row.serverName,
                                                            overridesGlobal: globalNames.has(row.serverName),
                                                            confirming: state.removeTarget === row.serverName,
                                                            comments: state.removeComments,
                                                            onEdit: (name) => {
                                                                startEdit(name);
                                                            },
                                                            onToggle: (target) => {
                                                                void toggle(target);
                                                            },
                                                            onRemoveRequest: (target) => {
                                                                void removeRequest(target);
                                                            },
                                                            onRemoveConfirm: () => {
                                                                void removeConfirm();
                                                            },
                                                            onRemoveCancel: () => {
                                                                removeCancel();
                                                            }
                                                        }, row.serverName))
                                                    }),
                                                jsx("p", { style: S.note, children: t("projectCardHint") }),
                                                dirty ? jsx("p", { style: { ...S.meta, ...S.danger }, children: t("projectDirty") }) : null
                                            ]
                                        }),
                                // 源码是备用手段：默认折叠，放在页面最下方。
                                jsxs("div", {
                                    style: S.importBox,
                                    "data-mcp-project-source": true,
                                    children: [
                                        jsxs("div", {
                                            style: S.actions,
                                            children: [
                                                jsx("button", {
                                                    type: "button",
                                                    style: S.button,
                                                    onClick: () => {
                                                        setState((current) => ({ ...current, sourceOpen: !current.sourceOpen }));
                                                    },
                                                    children: state.sourceOpen ? t("projectSourceHide") : t("projectSourceShow")
                                                }),
                                                jsx("span", { style: S.note, children: t("projectSourceHint") })
                                            ]
                                        }),
                                        state.sourceOpen
                                            ? jsxs(React.Fragment, {
                                                children: [
                                                    jsx("textarea", {
                                                        style: S.textarea,
                                                        rows: 14,
                                                        spellCheck: false,
                                                        value: state.text,
                                                        onChange: (event) => {
                                                            setState((current) => ({ ...current, text: event.target.value, notice: null }));
                                                        }
                                                    }),
                                                    jsxs("div", {
                                                        style: S.actions,
                                                        children: [
                                                            jsx("button", {
                                                                type: "button",
                                                                style: { ...S.button, ...S.primary },
                                                                disabled: state.busy !== null,
                                                                onClick: () => {
                                                                    void saveSource();
                                                                },
                                                                children: state.busy === "source" ? t("saving") : t("projectSave")
                                                            }),
                                                            jsx("span", { style: S.note, children: t("projectSaveHint") })
                                                        ]
                                                    }),
                                                    jsxs("div", {
                                                        style: S.importBox,
                                                        children: [
                                                            jsx("span", { style: { ...S.meta, fontWeight: 600 }, children: t("projectImportTitle") }),
                                                            jsx("textarea", {
                                                                style: S.textarea,
                                                                rows: 4,
                                                                placeholder: t("projectImportPlaceholder"),
                                                                value: state.importText,
                                                                onChange: (event) => {
                                                                    setState((current) => ({ ...current, importText: event.target.value, importError: null }));
                                                                }
                                                            }),
                                                            jsxs("div", {
                                                                style: S.actions,
                                                                children: [
                                                                    jsx("button", {
                                                                        type: "button",
                                                                        style: S.button,
                                                                        disabled: state.importText.trim().length === 0,
                                                                        onClick: () => {
                                                                            void convert();
                                                                        },
                                                                        children: t("projectImportAction")
                                                                    }),
                                                                    jsx("span", { style: S.note, children: t("projectImportHint") })
                                                                ]
                                                            }),
                                                            state.importError !== null
                                                                ? jsx("p", { style: { ...S.meta, ...S.danger }, children: state.importError })
                                                                : null,
                                                            state.warnings.length === 0
                                                                ? null
                                                                : jsxs("div", {
                                                                    style: S.warnBox,
                                                                    children: [
                                                                        jsx("span", { style: S.meta, children: t("warningsLabel") }),
                                                                        ...state.warnings.map((warning) => jsx("span", {
                                                                            style: S.meta,
                                                                            children: warning
                                                                        }, warning))
                                                                    ]
                                                                }),
                                                            state.overwritten.length === 0
                                                                ? null
                                                                : jsx("p", {
                                                                    style: S.meta,
                                                                    children: `${t("projectOverwritten")}: ${state.overwritten.join("、")}`
                                                                })
                                                        ]
                                                    })
                                                ]
                                            })
                                            : null
                                    ]
                                })
                            ]
                        })
                ]
            });
        }

        /**
         * 设置页入口：顶部两个 tab。
         *
         * 两个面板都保持挂载，只切显隐：项目页里可能正编着一大段文本，
         * 来回切 tab 不该把它清空（重新挂载会重新读文件、丢掉未保存的编辑）。
         */
        function McpSection(props) {
            const { t } = props;
            const state = props.useMcpPanel((snapshot) => snapshot);
            const [tab, setTab] = React.useState("global");

            React.useEffect(() => {
                props.ensure();
            }, []);

            const tabButton = (key, label) => jsx("button", {
                type: "button",
                style: tab === key ? { ...S.button, ...S.tabActive } : S.button,
                onClick: () => {
                    setTab(key);
                },
                children: label
            }, key);

            return jsxs("div", {
                style: S.page,
                "data-mcp-section": true,
                children: [
                    jsxs("div", {
                        style: S.tabs,
                        children: [
                            tabButton("global", t("tabGlobal")),
                            tabButton("project", t("tabProject"))
                        ]
                    }),
                    jsx("div", {
                        style: tab === "global" ? undefined : { display: "none" },
                        children: jsx(GlobalPanel, { ...props, state })
                    }),
                    jsx("div", {
                        style: tab === "project" ? undefined : { display: "none" },
                        // 工作区列表来自全局槽位注入；拿不到就退化成空列表而不是崩掉
                        // （本插件不 import 任何 dsh-client-* 包，见文件头）。
                        // 全局行只给项目卡片标注「覆盖全局」用，缺失时不影响渲染。
                        children: typeof props.useWorkspaces === "function"
                            ? jsx(ProjectPanel, { t, useWorkspaces: props.useWorkspaces, globalRows: state.rows })
                            : jsx("p", { style: S.meta, children: t("noWorkspace") })
                    })
                ]
            });
        }
        //#endregion

        //#region 插件入口
        /** 必需服务：槽位、文案，以及插件管理器（启停）。 */
        const inject = ["slots", "locale", "remote", "remote.pluginManager"];

        function apply(ctx) {
            const t = ctx.locale.bind(NS);
            ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-mcp-manager: dictionaries");

            const controller = new McpController(ctx);

            // 注入面只构造一次：函数身份稳定，组件里的 useEffect([]) 才不会反复触发。
            const face = {
                hooks: { mcpPanel: controller },
                ensure: () => {
                    controller.ensure();
                },
                reload: () => {
                    void controller.load();
                },
                onEdit: (id) => {
                    controller.edit(id);
                },
                onCreate: () => {
                    controller.startCreate();
                },
                onField: (field, value) => {
                    controller.updateDraft(field, value);
                },
                onTransport: (value) => {
                    controller.setTransport(value);
                },
                onSave: () => {
                    void controller.save();
                },
                onCancel: () => {
                    controller.cancelEdit();
                },
                onToggle: (row) => {
                    void controller.toggle(row);
                },
                onImportText: (value) => {
                    controller.setImportText(value);
                },
                onParseImport: () => {
                    controller.startImport();
                },
                onRowId: (value) => {
                    controller.setRowId(value);
                },
                onSkip: () => {
                    controller.skipCurrent();
                },
                onRemoveRequest: (row) => {
                    void controller.removeRequest(row);
                },
                onRemoveConfirm: () => {
                    void controller.removeConfirm();
                },
                onRemoveCancel: () => {
                    controller.removeCancel();
                }
            };

            ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
                name: "settings.section",
                id: "mcp-manager",
                order: 60,
                label: () => t("nav"),
                locale: NS,
                inject: () => face
            }, McpSection)), "dsh-mcp-manager: settings section");
        }
        //#endregion

        exports.NS = NS;
        exports.apply = apply;
        exports.inject = inject;
        return module.exports;
    }
});

# Agent 跃迁插件设计文档

> **目标**: 实现 OpenClaw Agent 配置的云端同步与跨设备跃迁，保持会话连续性

---

## 📋 需求定义

### 核心功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **导出** | 打包单个/全部 agent 的配置、会话、工作区 | P0 |
| **云端存储** | 上传到 GitHub Gist / WebDAV / 云盘 | P0 |
| **导入** | 从云端下载并恢复到目标 OpenClaw | P0 |
| **Channel 续接** | 保持 channel 绑定，消息不中断 | P0 |
| **凭证安全** | 不打包明文密钥，使用 SecretRef | P0 |
| **增量同步** | 只同步变更内容 | P1 |
| **版本管理** | 支持回滚到历史版本 | P1 |
| **冲突解决** | 多设备同步冲突处理 | P2 |

---

## 📦 需要迁移的文件清单

### 第一层：核心配置 (必需)

```
~/.openclaw/
├── openclaw.json                    # 主配置文件 (完整)
├── auth-profiles.json               # OAuth 凭证引用 (完整，但清除 token)
├── secrets.json                     # SecretProvider 配置 (如有)
└── .env                             # 环境变量文件 (脱敏处理)
```

### 第二层：Agent 专属 (按 agentId 隔离)

```
~/.openclaw/agents/<agentId>/
├── agent/
│   ├── openclaw.json                # Agent 级配置覆盖
│   ├── auth-profiles.json           # Agent 级 OAuth 配置
│   └── models.json                  # Agent 级模型目录
├── sessions/
│   ├── sessions.json                # 会话索引 (核心!)
│   ├── transcripts/                 # 会话历史记录目录
│   │   └── agent:<agentId>:<channel>:<chatType>:<peerId>/
│   │       └── transcript.jsonl     # 会话历史 (可选)
│   └── <sessionId>.jsonl            # 独立会话记录 (Telegram topic 等)
└── workspace/                       # 工作区 (如果独立)
    ├── SOUL.md
    ├── MEMORY.md
    ├── USER.md
    ├── AGENTS.md
    ├── TOOLS.md
    ├── HEARTBEAT.md
    ├── BOOTSTRAP.md (archived)
    ├── IDENTITY.md
    ├── memory/
    │   └── YYYY-MM-DD.md            # 每日记忆日志
    └── assets/                      # 工作区资源文件
```

### 第三层：记忆索引 (选择性迁移)

```
~/.openclaw/memory/
├── main.sqlite                      # main agent 的向量索引
└── momiji.sqlite                    # momiji agent 的向量索引
```

**重要发现**: 
- ❌ **memory.sqlite 不是共享的** — 每个 agent 有独立的索引文件
- ✅ **索引文件不需要迁移** — 可以从 Markdown 源文件重新生成
- 📝 **真正的记忆数据在 Markdown 文件中**:
  - `MEMORY.md` (长期记忆)
  - `memory/YYYY-MM-DD.md` (每日记忆)

**重新生成流程**:
```bash
# 导入后为每个 agent 重新生成索引
openclaw memory index --agent main --force
openclaw memory index --agent momiji --force
```

**影响评估**:
- 重新生成索引 **不会影响记忆内容** — Markdown 文件才是数据源
- 索引只是加速搜索的缓存，类似数据库索引
- 唯一影响：重新生成需要调用 embedding API (有少量 token 成本)

### 第四层：全局共享 (选择性迁移)

```
~/.openclaw/
├── workspace/                       # 全局工作区 (如果多 agent 共享)
│   ├── SOUL.md
│   ├── MEMORY.md
│   ├── memory/
│   └── assets/
├── credentials/                     # 凭证存储 (不打包明文!)
│   └── oauth.json                   # 仅迁移引用
├── plugins/                         # 插件配置
│   ├── installs/                    # 插件安装元数据
│   └── <plugin-name>/               # 插件数据
└── skills/                          # 技能配置
    └── entries/                     # 技能启用状态
```

### 第五层：Gateway 状态 (不迁移)

```
~/.openclaw/
├── gateway/                         # Gateway 运行时状态
│   ├── identity.json                # Gateway 身份 (不迁移)
│   └── ...
├── dns/                             # DNS-SD 配置
└── logs/                            # 日志文件 (不迁移)
```

---

## 🔍 配置依赖分析

### 必须一起迁移的配置项

| 配置路径 | 说明 | 依赖关系 |
|----------|------|----------|
| `agents.list[]` | Agent 定义 | 核心 |
| `agents.defaults.*` | Agent 默认配置 | 被所有 agent 依赖 |
| `agents.defaults.models.*` | 模型别名配置 | 被 session 引用 |
| `agents.defaults.memorySearch.*` | 记忆搜索配置 | **每个 agent 独立**，被 memory 工具引用 |
| `agents.defaults.compaction.*` | 会话压缩配置 | 被 session 引用 |
| `agents.defaults.sandbox.*` | 沙盒配置 | 被 exec 工具引用 |
| `bindings[]` | Channel→Agent 路由 | 必须与 agent 一起 |
| `channels.*` | Channel 配置 | 目标端需预先配置 |
| `channels.<channel>.accounts.*` | Channel 多账户配置 | 被 bindings 引用 |
| `models.providers.*` | 模型提供商配置 | 被 model 引用 |
| `secrets.providers.*` | Secret 提供商 | 被 SecretRef 引用 |
| `auth.profiles.*` | OAuth 配置 | 被 provider 引用 |
| `plugins.entries.*` | 插件配置 | 被 agent 工具引用 |
| `plugins.installs.*` | 插件安装元数据 | 被插件系统引用 |
| `plugins.slots.*` | 插件槽位配置 | 被插件系统引用 |
| `skills.entries.*` | 技能配置 | 被 agent 引用 |
| `session.*` | 会话管理配置 | 被 session 系统引用 |
| `session.maintenance.*` | 会话维护配置 | 被 session 清理引用 |
| `tools.*` | 工具配置 | 被 agent 工具引用 |
| `tools.web.*` | Web 工具配置 | 被 web_search/web_fetch 引用 |
| `tools.media.*` | 媒体工具配置 | 被 image/audio 工具引用 |
| `hooks.*` | Hook 配置 | 被 webhook 系统引用 |
| `hooks.internal.entries.*` | 内部 Hook 配置 | 被内部系统引用 |

### Channel 续接关键

```json
// bindings 决定消息路由到哪个 agent
{
  "bindings": [
    {
      "agentId": "main",
      "match": {
        "channel": "qqbot",
        "accountId": "marie_bot"
      }
    }
  ]
}
```

**续接条件**:
1. 目标端 `agentId` 必须相同
2. 目标端 `bindings` 配置必须相同
3. `sessions.json` 中的会话 key 必须保持不变
4. Channel 配置 (`channels.qqbot.accounts`) 需在目标端存在

### Session Key 格式 (核心!)

会话 key 格式决定了消息能否续接到正确的会话：

```
# DM 会话 (根据 dmScope 不同)
agent:<agentId>:<mainKey>                    # dmScope: "main" (默认)
agent:<agentId>:direct:<peerId>              # dmScope: "per-peer"
agent:<agentId>:<channel>:direct:<peerId>    # dmScope: "per-channel-peer"
agent:<agentId>:<channel>:<accountId>:direct:<peerId>  # dmScope: "per-account-channel-peer"

# 群聊会话
agent:<agentId>:<channel>:group:<groupId>
agent:<agentId>:<channel>:channel:<channelId>

# Telegram Topic
agent:<agentId>:telegram:group:<groupId>:topic:<threadId>

# Discord Thread
agent:<agentId>:discord:channel:<channelId>:thread:<threadId>

# Cron 会话
cron:<jobId>           # 隔离会话 (每次运行新建)
session:<custom-id>    # 持久会话

# Webhook 会话
hook:<uuid>
```

**关键配置**: `session.dmScope` 决定了 DM 会话的隔离级别，必须与源端一致！

---

## 🏗️ 插件架构设计

### 目录结构

```
agent-migration-plugin/
├── package.json
├── src/
│   ├── index.ts                 # 插件入口
│   ├── commands/
│   │   ├── export.ts            # 导出命令
│   │   ├── import.ts            # 导入命令
│   │   ├── list.ts              # 列表命令
│   │   └── verify.ts            # 验证命令
│   ├── exporters/
│   │   ├── github-gist.ts       # GitHub Gist 导出器
│   │   ├── webdav.ts            # WebDAV 导出器
│   │   └── local.ts             # 本地文件导出器
│   ├── packer/
│   │   ├── manifest.ts          # manifest.json 生成
│   │   ├── config-extractor.ts  # 配置提取逻辑
│   │   └── archive.ts           # zip 打包逻辑
│   └── types/
│       └── migration.ts         # 类型定义
└── README.md
```

### 插件注册

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "agent-migration",
  name: "Agent Migration",
  version: "1.0.0",
  
  register(api) {
    // 注册 CLI 命令
    api.registerCli({
      namespace: "agent",
      commands: [
        { name: "migrate:export", handler: exportHandler },
        { name: "migrate:import", handler: importHandler },
        { name: "migrate:list", handler: listHandler },
        { name: "migrate:verify", handler: verifyHandler },
      ]
    });
    
    // 注册 HTTP 端点 (用于云端同步 webhook)
    api.registerHttpRoute({
      path: "/migration/webhook",
      method: "POST",
      handler: webhookHandler
    });
  }
});
```

---

## 📝 Manifest 格式

```json
{
  "schema": "openclaw-migration/v1",
  "createdAt": "2026-03-31T10:00:00.000Z",
  "openclawVersion": "2026.3.28",
  "source": {
    "host": "LAPTOP-IK6F0NS4",
    "agentId": "main",
    "workspace": "C:\\Users\\zheng\\.openclaw\\workspace"
  },
  "contents": {
    "config": true,
    "sessions": true,
    "transcripts": false,
    "workspace": true,
    "memory": true
  },
  "checksums": {
    "openclaw.json": "sha256:...",
    "sessions.json": "sha256:..."
  },
  "requires": {
    "channels": ["qqbot"],
    "plugins": ["channels"],
    "skills": ["marie-stickers"]
  },
  "notes": "玛莉萝丝主 agent 跃迁包"
}
```

---

## 🔐 安全设计

### 凭证处理策略

| 类型 | 处理方式 | 说明 |
|------|----------|------|
| `apiKey` (明文) | ❌ 不打包，替换为 `__REDACTED__` | 包括 `models.providers.*.apiKey` |
| `SecretRef` | ✅ 完整保留引用配置 | `{source, provider, id}` 结构不变 |
| OAuth tokens | ❌ 不打包，目标端重新授权 | `auth-profiles.json` 中清除 `accessToken`, `refreshToken` |
| `auth-profiles.json` | ✅ 保留配置结构，清除 token | 保留 `provider`, `mode`, `email` 等元数据 |
| `channels.*.token` | ❌ 不打包，替换为 `__REDACTED__` | Channel API token |
| `channels.*.clientSecret` | ❌ 不打包，替换为 `__REDACTED__` | OAuth client secret |
| `gateway.auth.token` | ❌ 不打包，目标端重新生成 | Gateway 认证 token |
| `gateway.auth.password` | ❌ 不打包，目标端重新设置 | Gateway 密码 |
| `secrets.providers.*` | ✅ 完整保留 | Provider 配置本身不包含敏感值 |
| `.env` 文件 | ⚠️ 脱敏处理 | 保留非敏感配置，清除 `*_KEY`, `*_TOKEN`, `*_SECRET` |

### 脱敏规则

```typescript
const SENSITIVE_PATTERNS = [
  /_API_KEY$/i,
  /_TOKEN$/i,
  /_SECRET$/i,
  /_PASSWORD$/i,
  /apiKey$/i,
  /token$/i,
  /secret$/i,
  /password$/i,
  /clientSecret$/i,
  /accessToken$/i,
  /refreshToken$/i,
];
```

### 加密选项

```typescript
interface EncryptionOptions {
  enabled: boolean;
  algorithm: "aes-256-gcm";
  keyDerivation: "pbkdf2" | "argon2";
  password?: string;  // 或通过密钥文件
}
```

---

## 🔄 工作流程

### 导出流程

```
1. 用户执行: openclaw agent migrate export --agent main --target github
2. 验证 agent 存在
3. 提取配置:
   - 读取 ~/.openclaw/openclaw.json
   - 过滤出 target agent 相关配置
   - 读取 agent 专属配置 (agentDir)
   - 读取 sessions.json
   - 读取工作区文件
4. 生成 manifest.json
5. 清理敏感数据 (凭证脱敏)
6. 打包为 zip
7. 上传到目标存储
8. 返回分享链接/ID
```

### 导入流程

```
1. 用户执行: openclaw agent migrate import --source github:<id>
2. 下载并解压跃迁包
3. 验证 manifest 完整性
4. 检查目标端依赖 (channels, plugins, skills)
5. 合并配置:
   - 保留目标端的凭证配置
   - 合并 agent 配置
   - 合并 bindings
6. 恢复会话数据:
   - 复制 sessions.json
   - 复制 transcripts (如有)
7. 恢复工作区文件
8. 提示用户重启 gateway
```

---

## ⚠️ 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 配置冲突 | 导入覆盖目标端配置 | 提供 `--merge` / `--overwrite` 选项 |
| 凭证丢失 | 导入后无法连接 | 导入前检查 SecretRef 配置完整性 |
| 会话断裂 | session key 不匹配 | 严格保持 agentId 和 bindings 不变 |
| 版本不兼容 | 旧版本格式无法解析 | manifest 中记录 OpenClaw 版本 |
| Channel 未配置 | 消息无法路由 | 导入时检查并提示缺失的 channel |

---

## 📋 实现清单

### Phase 1: 基础功能 (P0)

- [ ] 配置提取逻辑实现
- [ ] manifest.json 生成
- [ ] 本地 zip 打包
- [ ] 本地导入恢复
- [ ] 凭证脱敏处理
- [ ] 基础 CLI 命令

### Phase 2: 云端存储 (P0)

- [ ] GitHub Gist 导出器
- [ ] WebDAV 导出器
- [ ] 本地文件导出器
- [ ] 上传/下载逻辑
- [ ] 认证处理

### Phase 3: 增强功能 (P1)

- [ ] 增量同步 (对比 checksums)
- [ ] 版本历史管理
- [ ] 配置合并策略
- [ ] 依赖检查增强
- [ ] 导入前预览

### Phase 4: 高级功能 (P2)

- [ ] 多设备冲突解决
- [ ] 加密/解密支持
- [ ] 自动备份定时任务
- [ ] Web UI 管理界面

---

## 🧪 测试计划

### 测试场景

1. **单 Agent 跃迁**
   - 导出 main agent → 导入到新设备 → 验证消息续接

2. **多 Agent 跃迁**
   - 导出全部 agent → 选择性导入

3. **配置冲突**
   - 目标端已有同名 agent → 测试 merge/overwrite

4. **凭证安全**
   - 验证导出的包中无明文密钥

5. **Channel 续接**
   - 导入后发送消息 → 验证会话连续性

6. **Session Key 一致性**
   - 验证 `sessions.json` 中的 key 格式与源端一致
   - 验证 `session.dmScope` 配置一致

7. **记忆系统**
   - 验证 `MEMORY.md` 和 `memory/*.md` 完整迁移
   - 验证向量索引可以重新生成

---

## ✅ 导入后验证清单

### 配置验证

```bash
# 1. 验证配置合法性
openclaw config validate

# 2. 验证 SecretRef 配置
openclaw secrets audit --check

# 3. 验证 agent 配置
openclaw agents list

# 4. 验证 session 配置
openclaw sessions --json
```

### 功能验证

```bash
# 5. 验证记忆系统
openclaw memory status

# 6. 验证 channel 状态
openclaw channels status

# 7. 验证 gateway 状态
openclaw gateway status
```

### 会话续接验证

1. 在源设备发送测试消息
2. 在目标设备查看会话历史
3. 在目标设备回复消息
4. 验证消息在同一会话中续接

---

## ⚠️ 故障排查

### 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 消息路由到新会话 | `session.dmScope` 不一致 | 检查并统一配置 |
| Channel 无法启动 | 凭证未配置 | 重新配置 channel 凭证 |
| 模型调用失败 | SecretRef 未解析 | 运行 `openclaw secrets configure` |
| 记忆搜索不可用 | 向量索引缺失 | 运行 `openclaw memory index --force` |
| 插件加载失败 | 插件未安装 | 运行 `openclaw plugins install` |
| 技能不可用 | 技能未启用 | 检查 `skills.entries` 配置 |

### 日志位置

```
# Gateway 日志
/tmp/openclaw/openclaw.log

# 会话日志
~/.openclaw/agents/<agentId>/sessions/transcripts/
```

---

## 📚 参考文档

- [OpenClaw Configuration Reference](/gateway/configuration-reference)
- [OpenClaw Plugin SDK](/plugins/sdk-overview)
- [OpenClaw Session Management](/cli/sessions)
- [OpenClaw Secrets Management](/gateway/secrets)
- [OpenClaw Multi-Agent](/concepts/multi-agent)

---

*文档创建时间：2026-03-31 10:48*
*创建者：玛莉萝丝 (Marie Rose)* 👓🌹

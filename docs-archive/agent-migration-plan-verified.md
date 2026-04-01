# Agent 跃迁插件设计文档 (已核实版)

> **目标**: 实现 OpenClaw Agent 配置的云端同步与跨设备跃迁，保持会话连续性  
> **核实时间**: 2026-03-31 10:58  
> **核实者**: 玛莉萝丝 (Marie Rose) 👓

---

## ✅ 实际目录结构核实

### 当前环境配置

```
OpenClaw 状态目录：C:\Users\zheng\.openclaw
Agent 数量：2 (main, momiji)
工作区：
  - main: C:\Users\zheng\.openclaw\workspace
  - momiji: C:\Users\zheng\.openclaw\workspace-momiji
```

### 实际目录树

```
C:\Users\zheng\.openclaw\
├── openclaw.json                    # ✅ 主配置
├── auth-profiles.json               # ✅ 在 agents/main/agent/ 和 agents/momiji/agent/ 下
├── .env                             # ✅ 在 workspace 下
│
├── agents/
│   ├── main/
│   │   ├── agent/
│   │   │   ├── auth-profiles.json   # ✅ Agent 级 OAuth
│   │   │   ├── auth.json            # ⚠️ 遗留文件 (已废弃)
│   │   │   └── models.json          # ✅ Agent 级模型配置
│   │   └── sessions/
│   │       ├── sessions.json        # ✅ 会话索引
│   │       ├── *.jsonl              # ✅ 会话历史
│   │       ├── *.jsonl.reset.*      # ✅ 重置归档
│   │       └── *.jsonl.deleted.*    # ✅ 删除归档
│   │
│   └── momiji/
│       ├── agent/
│       │   └── (同 main 结构)
│       └── sessions/
│           └── (同 main 结构)
│
├── workspace/                       # ✅ main agent 工作区
│   ├── SOUL.md
│   ├── MEMORY.md
│   ├── USER.md
│   ├── AGENTS.md
│   ├── TOOLS.md
│   ├── HEARTBEAT.md
│   ├── BOOTSTRAP.md (archived)
│   ├── IDENTITY.md
│   ├── .env
│   ├── memory/
│   │   └── YYYY-MM-DD.md
│   └── assets/
│
├── workspace-momiji/                # ✅ momiji agent 工作区
│   ├── SOUL.md
│   ├── MEMORY.md
│   ├── USER.md
│   ├── AGENTS.md
│   ├── TOOLS.md
│   ├── HEARTBEAT.md
│   └── IDENTITY.md
│
├── memory/
│   ├── main.sqlite                  # ✅ main 向量索引
│   └── momiji.sqlite                # ✅ momiji 向量索引
│
├── credentials/
│   └── whatsapp/default/            # ✅ WhatsApp 凭证
│       └── app-state-sync-key-*.json
│
├── (运行时目录 - 不迁移)
│   ├── identity/
│   ├── logs/
│   ├── data/
│   ├── delivery-queue/
│   ├── subagents/
│   ├── browser/
│   ├── canvas/
│   ├── completions/
│   ├── cron/
│   ├── devices/
│   └── qqbot/
│
└── (备份文件 - 选择性迁移)
    ├── openclaw.json.bak.*
    └── memory.zip
```

---

## 📦 需要迁移的文件清单 (修正版)

### 第一层：核心配置 (必需)

```
~/.openclaw/
├── openclaw.json                    # 主配置文件 (完整)
└── .env                             # 环境变量文件 (脱敏处理)
```

**注意**: `auth-profiles.json` 在每个 agent 的 `agent/` 目录下，不在根目录！

### 第二层：Agent 专属 (按 agentId 隔离)

```
~/.openclaw/agents/<agentId>/
├── agent/
│   ├── auth-profiles.json           # Agent 级 OAuth 配置 (清除 token)
│   └── models.json                  # Agent 级模型目录
└── sessions/
    ├── sessions.json                # 会话索引 (核心!)
    └── *.jsonl                      # 会话历史记录 (可选，体积大)
```

**⚠️ 重要修正**:
- `auth.json` 是遗留文件，已废弃，**不需要迁移**
- 会话历史文件 (`*.jsonl`) 体积较大，可选择性迁移
- `*.jsonl.reset.*` 和 `*.jsonl.deleted.*` 是归档文件，**不需要迁移**

### 第三层：工作区文件 (每个 agent 独立)

```
~/.openclaw/workspace-<agentId>/     # 或配置的 workspace 路径
├── SOUL.md                          # 人格定义 (必需)
├── MEMORY.md                        # 长期记忆 (必需)
├── USER.md                          # 用户信息 (必需)
├── AGENTS.md                        # Agent 指令 (必需)
├── TOOLS.md                         # 工具配置 (必需)
├── HEARTBEAT.md                     # 心跳协议 (必需)
├── IDENTITY.md                      # 身份信息 (必需)
├── .env                             # 环境变量 (脱敏)
├── memory/
│   └── YYYY-MM-DD.md                # 每日记忆 (必需)
└── assets/                          # 资源文件 (可选)
```

**实际配置关联**:
```json
// openclaw.json 中配置
{
  "agents": {
    "list": [
      {
        "id": "main",
        "workspace": "C:\\Users\\zheng\\.openclaw\\workspace"
      },
      {
        "id": "momiji",
        "workspace": "C:\\Users\\zheng\\.openclaw\\workspace-momiji"
      }
    ]
  }
}
```

### 第四层：记忆索引 (不需要迁移)

```
~/.openclaw/memory/
├── main.sqlite                      # 可从 Markdown 重新生成
└── momiji.sqlite                    # 可从 Markdown 重新生成
```

**处理策略**: 
- ❌ **不打包** — 导入后重新生成
- ✅ 命令：`openclaw memory index --agent <agentId> --force`

### 第五层：凭证目录 (不迁移明文)

```
~/.openclaw/credentials/
└── whatsapp/default/
    └── app-state-sync-key-*.json    # WhatsApp 状态同步密钥
```

**处理策略**:
- ❌ **不打包明文凭证**
- ✅ 目标端重新登录/配对生成

### 第六层：运行时状态 (不迁移)

```
~/.openclaw/
├── identity/                        # Gateway 身份
├── logs/                            # 日志
├── data/                            # 运行数据
├── delivery-queue/                  # 消息队列
├── subagents/                       # 子代理状态
├── browser/                         # 浏览器状态
├── canvas/                          # Canvas 缓存
├── completions/                     # 补全缓存
├── cron/                            # Cron 运行记录
├── devices/                         # 设备配对
└── qqbot/                           # QQBot 状态
```

**处理策略**: 
- ❌ **全部不迁移** — 目标端重新生成

---

## 🔍 配置依赖分析 (修正)

### 工作区配置路径

在 `openclaw.json` 中查找：

```json
{
  "agents": {
    "defaults": {
      "workspace": "C:\\Users\\zheng\\.openclaw\\workspace"  // 默认工作区
    },
    "list": [
      {
        "id": "main"
        // 未配置 workspace 时使用 defaults.workspace
      },
      {
        "id": "momiji",
        "workspace": "C:\\Users\\zheng\\.openclaw\\workspace-momiji"  // 独立工作区
      }
    ]
  }
}
```

### 必须一起迁移的配置项

| 配置路径 | 说明 | 位置 |
|----------|------|------|
| `openclaw.json` | 主配置 | `~/.openclaw/` |
| `agents.list[]` | Agent 定义 (含 workspace 路径) | `openclaw.json` 内 |
| `agents.defaults.*` | Agent 默认配置 | `openclaw.json` 内 |
| `bindings[]` | Channel→Agent 路由 | `openclaw.json` 内 |
| `channels.*` | Channel 配置 | `openclaw.json` 内 |
| `models.providers.*` | 模型提供商配置 | `openclaw.json` 内 |
| `auth.profiles.*` | OAuth 配置 | `agents/<id>/agent/auth-profiles.json` |
| `session.*` | 会话管理配置 | `openclaw.json` 内 |
| `tools.*` | 工具配置 | `openclaw.json` 内 |
| `plugins.entries.*` | 插件配置 | `openclaw.json` 内 |
| `skills.entries.*` | 技能配置 | `openclaw.json` 内 |

---

## 🔄 跃迁流程 (修正版)

### 导出流程

```
1. 用户执行：openclaw agent migrate export --agent main --target local
2. 验证 agent 存在
3. 提取配置:
   - 读取 ~/.openclaw/openclaw.json (完整)
   - 读取 agents/<agentId>/agent/auth-profiles.json (清除 token)
   - 读取 agents/<agentId>/agent/models.json
   - 读取 agents/<agentId>/sessions/sessions.json
   - 读取 workspace 目录 (根据 openclaw.json 配置)
     - SOUL.md, MEMORY.md, USER.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, IDENTITY.md
     - memory/*.md
     - assets/ (可选)
   - 读取 .env (脱敏处理)
4. 生成 manifest.json
5. 清理敏感数据:
   - 清除 auth-profiles.json 中的 accessToken, refreshToken
   - 清除 openclaw.json 中的明文 apiKey, token, secret
   - 清除 .env 中的敏感变量
6. 打包为 zip (排除 *.sqlite, *.log, 运行时目录)
7. 返回本地路径或上传到云端
```

### 导入流程

```
1. 用户执行：openclaw agent migrate import --source ./migration.zip
2. 下载并解压跃迁包
3. 验证 manifest 完整性
4. 检查目标端依赖 (channels, plugins, skills)
5. 合并配置:
   - 保留目标端的凭证配置 (API keys, tokens)
   - 合并 agent 配置到 openclaw.json
   - 合并 bindings
   - 复制 auth-profiles.json (不含 token)
   - 复制 models.json
6. 恢复会话数据:
   - 复制 sessions.json
   - 复制 *.jsonl (可选)
7. 恢复工作区文件:
   - 创建/更新 workspace 目录
   - 复制所有 Markdown 文件
   - 复制 .env (合并非敏感配置)
8. 重建索引:
   - openclaw memory index --agent main --force
   - openclaw memory index --agent momiji --force
9. 提示用户重启 gateway
```

---

## ⚠️ 重要修正总结

| 原文档描述 | 实际情况 | 修正 |
|------------|----------|------|
| `auth-profiles.json` 在根目录 | 在 `agents/<id>/agent/` 下 | ✅ 已修正 |
| `agents/<id>/workspace/` 存在 | 工作区在独立目录 | ✅ 已修正 |
| `memory.sqlite` 在 agent 目录下 | 在 `~/.openclaw/memory/` 下 | ✅ 已修正 |
| `secrets.json` 必需 | 当前环境不存在 | ⚠️ 可选 |
| `skills/` 目录在 `~/.openclaw/` | skills 在 npm 包中 | ✅ 已修正 |
| `plugins/` 目录有数据 | 当前环境为空 | ✅ 已修正 |

---

## 📋 排除文件列表 (更新)

```typescript
const EXCLUDE_PATTERNS = [
  // 向量索引 (可重新生成)
  '**/*.sqlite',
  
  // 日志文件
  '**/*.log',
  '**/logs/**',
  
  // Gateway 运行时状态
  '**/identity/**',
  '**/data/**',
  '**/delivery-queue/**',
  '**/subagents/**',
  '**/browser/**',
  '**/canvas/**',
  '**/completions/**',
  
  // 凭证 (目标端重新生成)
  '**/credentials/**',
  
  // 归档文件
  '**/*.deleted.*',
  '**/*.reset.*',
  '**/*.bak*',
  
  // 遗留文件
  '**/auth.json',  // 已废弃，auth-profiles.json 替代
  
  // 临时文件
  '**/*.tmp',
  '**/*.zip',
];
```

---

*文档创建时间：2026-03-31 10:48*  
*核实时间：2026-03-31 10:58*  
*创建者/核实者：玛莉萝丝 (Marie Rose)* 👓🌹

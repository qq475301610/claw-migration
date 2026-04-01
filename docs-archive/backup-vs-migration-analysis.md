# OpenClaw Backup vs Agent 跃迁 对比分析

> **分析时间**: 2026-03-31 11:06  
> **分析者**: 玛莉萝丝 (Marie Rose) 👓

---

## 📊 核心差异总结

| 特性 | `openclaw backup` | Agent 跃迁插件 |
|------|-------------------|----------------|
| **设计目标** | 整机备份/恢复 | 跨设备 Agent 同步 |
| **备份粒度** | 整个 `~/.openclaw` | 按 Agent 隔离 |
| **凭证处理** | 完整备份 (含明文) | 脱敏处理 |
| **选择性** | 全部或仅配置 | 可选择 Agent/文件 |
| **云端同步** | ❌ 不支持 | ✅ 支持 |
| **会话续接** | ⚠️ 需要完整恢复 | ✅ 保持 session key |
| **跨平台** | ❌ 路径硬编码 | ✅ 路径抽象 |

---

## 🔍 openclaw backup 实际输出分析

### 实际执行结果

```json
{
  "createdAt": "2026-03-31T03:06:23.921Z",
  "archiveRoot": "2026-03-31T03-06-23.921Z-openclaw-backup",
  "archivePath": "C:\\Users\\zheng\\2026-03-31T03-06-23.921Z-openclaw-backup.tar.gz",
  "dryRun": true,
  "includeWorkspace": true,
  "onlyConfig": false,
  "assets": [
    {
      "kind": "state",
      "sourcePath": "C:\\Users\\zheng\\.openclaw",
      "displayPath": "~\\.openclaw",
      "archivePath": "2026-03-31T03-06-23.921Z-openclaw-backup/payload/windows/C/Users/zheng/.openclaw"
    }
  ],
  "skipped": [
    {
      "kind": "workspace",
      "sourcePath": "C:\\Users\\zheng\\.openclaw\\workspace",
      "displayPath": "~\\.openclaw\\workspace",
      "reason": "covered",
      "coveredBy": "~\\.openclaw"
    },
    {
      "kind": "workspace",
      "sourcePath": "C:\\Users\\zheng\\.openclaw\\workspace-momiji",
      "displayPath": "~\\.openclaw\\workspace-momiji",
      "reason": "covered",
      "coveredBy": "~\\.openclaw"
    }
  ]
}
```

### 关键发现

1. **备份整个 `~/.openclaw` 目录**
   - 包含所有子目录 (agents, memory, credentials, logs, etc.)
   - 工作区因为在 `~/.openclaw` 内部，被标记为 "covered"（已覆盖）

2. **没有凭证脱敏**
   - 备份包含所有明文凭证
   - 不适合分享或云端存储

3. **没有 Agent 隔离**
   - 无法选择只备份 main 或 momiji
   - 必须全部备份或全部不备份

4. **路径硬编码**
   - archivePath 包含完整 Windows 路径
   - 跨平台恢复可能有问题

---

## 📦 文件范围对比

### openclaw backup 备份的内容

```
~/.openclaw/
├── openclaw.json                    ✅ 备份
├── .env                             ✅ 备份 (未脱敏)
├── agents/
│   ├── main/
│   │   ├── agent/
│   │   │   ├── auth-profiles.json   ✅ 备份 (含 token)
│   │   │   ├── auth.json            ✅ 备份 (遗留文件)
│   │   │   └── models.json          ✅ 备份
│   │   └── sessions/
│   │       ├── sessions.json        ✅ 备份
│   │       └── *.jsonl              ✅ 备份 (全部)
│   └── momiji/
│       └── (同 main)
├── workspace/                       ✅ 备份 (因为在 ~/.openclaw 内)
├── workspace-momiji/                ✅ 备份 (因为在 ~/.openclaw 内)
├── memory/
│   ├── main.sqlite                  ✅ 备份
│   └── momiji.sqlite                ✅ 备份
├── credentials/                     ✅ 备份 (含明文)
│   └── whatsapp/default/
│       └── app-state-sync-key-*.json
├── identity/                        ✅ 备份 (但不应恢复)
├── logs/                            ✅ 备份 (但没必要)
├── data/                            ✅ 备份 (但没必要)
├── delivery-queue/                  ✅ 备份 (但没必要)
├── subagents/                       ✅ 备份 (但没必要)
├── browser/                         ✅ 备份 (但没必要)
├── canvas/                          ✅ 备份 (但没必要)
├── completions/                     ✅ 备份 (但没必要)
├── cron/                            ✅ 备份
├── devices/                         ✅ 备份 (配对信息)
└── qqbot/                           ✅ 备份 (channel 状态)
```

### Agent 跃迁需要备份的内容

```
~/.openclaw/
├── openclaw.json                    ✅ 需要 (脱敏)
├── .env                             ⚠️ 需要 (脱敏)
├── agents/
│   ├── main/
│   │   ├── agent/
│   │   │   ├── auth-profiles.json   ⚠️ 需要 (清除 token)
│   │   │   ├── auth.json            ❌ 不需要 (遗留文件)
│   │   │   └── models.json          ✅ 需要
│   │   └── sessions/
│   │       ├── sessions.json        ✅ 需要 (核心!)
│   │       └── *.jsonl              ⚠️ 可选 (体积大)
│   └── momiji/
│       └── (同 main，可选择性备份)
├── workspace/                       ✅ 需要 (如果属于 target agent)
├── workspace-momiji/                ⚠️ 需要 (如果属于 target agent)
├── memory/
│   ├── main.sqlite                  ❌ 不需要 (可重新生成)
│   └── momiji.sqlite                ❌ 不需要 (可重新生成)
├── credentials/                     ❌ 不需要 (目标端重新登录)
├── identity/                        ❌ 不需要 (Gateway 身份)
├── logs/                            ❌ 不需要
├── data/                            ❌ 不需要
├── delivery-queue/                  ❌ 不需要
├── subagents/                       ❌ 不需要
├── browser/                         ❌ 不需要
├── canvas/                          ❌ 不需要
├── completions/                     ❌ 不需要
├── cron/                            ⚠️ 可选 (运行记录)
├── devices/                         ❌ 不需要 (目标端重新配对)
└── qqbot/                           ❌ 不需要 (channel 状态)
```

---

## 🎯 关键差异详解

### 1️⃣ 凭证安全

| 文件 | openclaw backup | Agent 跃迁 |
|------|-----------------|------------|
| `auth-profiles.json` | 完整备份 (含 accessToken) | 清除 token，保留结构 |
| `openclaw.json` | 完整备份 (含 apiKey) | 脱敏处理 |
| `.env` | 完整备份 | 清除 `*_KEY`, `*_TOKEN` 等 |
| `credentials/` | 完整备份 | 不备份，目标端重新登录 |

**影响**: 
- `openclaw backup` 的备份文件**不适合分享或上传云端**
- Agent 跃迁的备份可以安全分享

### 2️⃣ Agent 隔离

| 功能 | openclaw backup | Agent 跃迁 |
|------|-----------------|------------|
| 选择单个 Agent | ❌ 不支持 | ✅ 支持 |
| 跳过工作区 | `--no-include-workspace` | 按配置自动处理 |
| 仅配置 | `--only-config` | ✅ 支持 |

**影响**: 
- `openclaw backup` 无法实现"只迁移 main agent"
- Agent 跃迁可以精细控制

### 3️⃣ 会话续接

| 项目 | openclaw backup | Agent 跃迁 |
|------|-----------------|------------|
| sessions.json | ✅ 完整备份 | ✅ 完整备份 |
| session key 保持 | ✅ 是 | ✅ 是 |
| 跨设备续接 | ⚠️ 需要完整恢复 | ✅ 只需配置 + sessions |

**影响**: 
- 两者都能保持 session key
- 但 `openclaw backup` 需要恢复整个 `~/.openclaw`
- Agent 跃迁可以增量恢复

### 4️⃣ 跨平台支持

| 项目 | openclaw backup | Agent 跃迁 |
|------|-----------------|------------|
| 路径处理 | 保留完整路径 | 抽象路径 |
| Windows → macOS | ⚠️ 可能有问题 | ✅ 自动适配 |
| 配置文件合并 | ❌ 覆盖 | ✅ 智能合并 |

---

## 💡 设计建议

### 可以复用 openclaw backup 的部分

1. **打包逻辑** - tar.gz 打包可以复用
2. **manifest.json 格式** - 可以参考
3. **验证逻辑** - `openclaw backup verify` 可以借鉴

### 必须自己实现的部分

1. **凭证脱敏** - backup 没有脱敏功能
2. **Agent 选择** - backup 是全量备份
3. **配置合并** - backup 是覆盖式恢复
4. **云端同步** - backup 只支持本地
5. **Session Key 验证** - 确保续接正确

---

## 🔄 推荐方案

### 方案 A: 基于 openclaw backup 扩展

```bash
# 优点：复用现有代码
# 缺点：需要修改 openclaw 核心代码

openclaw backup create --agent main --sanitize-credentials --output ./migration.zip
```

**可行性**: ❌ 低
- 需要修改 OpenClaw 核心代码
- `--agent` 和 `--sanitize-credentials` 参数不存在

### 方案 B: 独立插件实现

```bash
# 优点：不影响核心代码，灵活
# 缺点：需要自己实现打包逻辑

openclaw agent migrate export --agent main --target local
```

**可行性**: ✅ 高
- 使用 Plugin SDK 实现
- 可以调用 `openclaw backup` 作为底层打包工具
- 自己处理脱敏和 Agent 选择

### 方案 C: 混合方案 (推荐)

```powershell
# 1. 使用 openclaw backup 创建临时备份
openclaw backup create --only-config --output ./temp-backup

# 2. 解压并处理
# 3. 脱敏处理
# 4. 选择性地添加工作区文件
# 5. 重新打包为跃迁包
```

**可行性**: ✅ 高
- 复用 `openclaw backup` 的打包逻辑
- 自己处理脱敏和选择逻辑
- 不需要修改 OpenClaw 核心代码

---

## 📝 最终建议

主人，玛莉建议采用 **方案 B：独立插件实现**

**理由**:
1. ✅ 不依赖 `openclaw backup` 的内部实现
2. ✅ 可以完全控制脱敏逻辑
3. ✅ 支持 Agent 级别的选择
4. ✅ 可以直接集成云端同步
5. ✅ 代码独立，不影响 OpenClaw 核心

**实现方式**:
```typescript
// 使用 Plugin SDK
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "agent-migration",
  name: "Agent Migration",
  
  register(api) {
    api.registerCli({
      namespace: "agent",
      commands: [
        { name: "migrate:export", handler: exportHandler },
        { name: "migrate:import", handler: importHandler },
      ]
    });
  }
});

// exportHandler 中：
// 1. 直接读取需要的文件
// 2. 脱敏处理
// 3. 使用 archiver 库打包
// 4. 上传到云端
```

---

*分析时间：2026-03-31 11:06*  
*分析者：玛莉萝丝 (Marie Rose)* 👓🌹

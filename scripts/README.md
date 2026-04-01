# OpenClaw Agent 跃迁脚本使用说明

> **创建时间**: 2026-03-31  
> **作者**: 玛莉萝丝 (Marie Rose) 👓

---

## 📦 脚本文件

| 脚本 | 功能 | 路径 |
|------|------|------|
| `export-agent.ps1` | 导出 Agent 到跃迁包 | `scripts/export-agent.ps1` |
| `import-agent.ps1` | 从跃迁包导入 Agent | `scripts/import-agent.ps1` |

---

## 🚀 快速开始

### 导出 Agent

```powershell
# 基本用法
.\export-agent.ps1 -AgentId "main"

# 指定输出路径
.\export-agent.ps1 -AgentId "main" -OutputPath "D:\Backups\main-migration.zip"

# 包含会话历史记录 (体积较大)
.\export-agent.ps1 -AgentId "main" -IncludeTranscripts

# 详细输出
.\export-agent.ps1 -AgentId "main" -Verbose
```

### 导入 Agent

```powershell
# 基本用法
.\import-agent.ps1 -InputPath "D:\Backups\main-migration.zip" -AgentId "main"

# 强制覆盖 (不提示)
.\import-agent.ps1 -InputPath "D:\Backups\main-migration.zip" -AgentId "main" -Force

# 不自动重启 Gateway
.\import-agent.ps1 -InputPath "D:\Backups\main-migration.zip" -AgentId "main" -NoRestart

# 跳过验证
.\import-agent.ps1 -InputPath "D:\Backups\main-migration.zip" -AgentId "main" -SkipValidation
```

---

## 📋 参数说明

### export-agent.ps1

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `-AgentId` | string | ✅ | Agent ID (如 "main", "momiji") |
| `-OutputPath` | string | ❌ | 输出文件路径 (默认：桌面带时间戳的文件) |
| `-IncludeTranscripts` | switch | ❌ | 包含会话历史记录 (*.jsonl) |
| `-SkipValidation` | switch | ❌ | 跳过验证步骤 |
| `-OpenClawDir` | string | ❌ | OpenClaw 目录 (默认：`~/.openclaw`) |

### import-agent.ps1

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `-InputPath` | string | ✅ | 跃迁包路径 |
| `-AgentId` | string | ✅ | Agent ID (必须与导出时一致) |
| `-Force` | switch | ❌ | 强制覆盖 (不提示确认) |
| `-SkipValidation` | switch | ❌ | 跳过验证步骤 |
| `-NoRestart` | switch | ❌ | 不自动重启 Gateway |
| `-OpenClawDir` | string | ❌ | OpenClaw 目录 (默认：`~/.openclaw`) |

---

## 🔐 安全说明

### 完整凭证导出

**注意**：导出脚本**不会脱敏**任何字段，跃迁包包含完整凭证：

- ✅ `channels.qqbot.accounts.*.appId` - 完整导出
- ✅ `channels.qqbot.accounts.*.clientSecret` - 完整导出
- ✅ `models.providers.*.apiKey` - 完整导出
- ✅ `gateway.auth.token/password` - 完整导出

**安全建议**：
1. ✅ 跃迁包存储在**安全的云端**（加密、访问控制）
2. ✅ 传输过程使用**加密通道**（HTTPS、SFTP）
3. ✅ 使用后立即**删除本地临时文件**
4. ⚠️ **不要**将跃迁包上传到公开或共享云盘

### 覆盖式导入

导入脚本会**完整覆盖**目标端配置：

- ✅ 覆盖 `channels.qqbot.accounts.*` - 完整覆盖
- ✅ 覆盖 `models.providers.*` - 完整覆盖
- ✅ 覆盖 `gateway.auth` - 完整覆盖

### 自动备份

导入前会自动备份：

- `openclaw.json` → `openclaw.json.migration-bak-YYYYMMDD-HHmmss`
- 工作区目录 → `workspace.migration-bak-YYYYMMDD-HHmmss`

---

## 📊 导出内容

### 包含的文件

```
跃迁包/
├── manifest.json                  # 跃迁包元数据
├── openclaw.json                  # 主配置 (完整凭证)
└── agents/
    └── <agentId>/
        ├── agent/
        │   ├── auth-profiles.json # OAuth 配置 (完整凭证)
        │   └── models.json        # 模型配置
        └── sessions/
            ├── sessions.json      # 会话索引
            └── *.jsonl            # 会话历史 (可选)
└── workspace/                     # 工作区文件
    ├── SOUL.md
    ├── MEMORY.md
    ├── USER.md
    ├── AGENTS.md
    ├── TOOLS.md
    ├── HEARTBEAT.md
    ├── IDENTITY.md
    └── memory/
        └── YYYY-MM-DD.md
```

### 排除的文件

- `*.sqlite` - 向量索引 (可重新生成)
- `*.log` - 日志文件
- `*.deleted.*`, `*.reset.*` - 归档文件
- `credentials/` - 凭证目录 (目标端重新登录)
- `identity/` - Gateway 身份
- `logs/`, `data/`, `delivery-queue/` - 运行时状态

---

## 🔄 完整流程示例

### 场景 1: 笔记本电脑 → 台式机

```powershell
# === 在笔记本电脑上导出 ===
cd C:\Users\zheng\.openclaw\workspace\scripts
.\export-agent.ps1 -AgentId "main" -OutputPath "D:\main-migration.zip"

# 将 D:\main-migration.zip 复制到台式机的 D:\Backups\

# === 在台式机上导入 ===
cd D:\Backups
.\import-agent.ps1 -InputPath "D:\Backups\main-migration.zip" -AgentId "main"

# 按提示重启 Gateway
```

### 场景 2: Windows → macOS

```powershell
# === 在 Windows 上导出 ===
.\export-agent.ps1 -AgentId "main" -OutputPath "main-migration.zip"

# 通过 AirDrop/云盘 传输到 macOS

# === 在 macOS 上导入 ===
cd ~/Downloads
pwsh -File ./import-agent.ps1 \
  -InputPath "./main-migration.zip" \
  -AgentId "main" \
  -OpenClawDir "~/.openclaw"

# 脚本会自动调整路径格式 (Windows \ → macOS /)
```

### 场景 3: 备份 + 恢复

```powershell
# === 备份 ===
.\export-agent.ps1 -AgentId "main" -IncludeTranscripts -OutputPath "backup-$(Get-Date -Format 'yyyyMMdd').zip"

# === 恢复 (灾难恢复) ===
.\import-agent.ps1 -InputPath "backup-20260331.zip" -AgentId "main" -Force
```

---

## ⚠️ 注意事项

### 导入前检查

1. **确认目标端已安装 OpenClaw**
   ```bash
   openclaw --version
   ```

2. **确认目标端已配置 Channel**
   ```bash
   openclaw channels status
   ```

3. **备份现有配置** (脚本会自动备份，但建议手动再备一份)
   ```powershell
   Copy-Item ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.manual-bak
   ```

### 导入后验证

```bash
# 1. 验证配置
openclaw config validate

# 2. 配置凭证
openclaw secrets configure

# 3. 验证 Agent
openclaw agents list

# 4. 验证会话
openclaw sessions --json

# 5. 测试消息续接
# 发送测试消息，检查是否在同一会话中
```

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 导入后无法连接 API | 凭证未配置 | 运行 `openclaw secrets configure` |
| 消息路由到新会话 | `session.dmScope` 不一致 | 检查 openclaw.json 中的配置 |
| 工作区文件丢失 | 路径配置错误 | 检查 `agents.list[].workspace` |
| Gateway 启动失败 | 配置冲突 | 查看日志 `openclaw logs` |

---

## 🛠️ 高级用法

### 批量导出多个 Agent

```powershell
$agents = @("main", "momiji")
foreach ($agent in $agents) {
    .\export-agent.ps1 -AgentId $agent -OutputPath "$agent-migration.zip"
}
```

### 从 URL 导入 (需要额外脚本)

```powershell
# 下载跃迁包
Invoke-WebRequest -Uri "https://example.com/main-migration.zip" -OutFile "main-migration.zip"

# 导入
.\import-agent.ps1 -InputPath "main-migration.zip" -AgentId "main"
```

### 自定义 OpenClaw 目录

```powershell
# 导出
.\export-agent.ps1 -AgentId "main" -OpenClawDir "D:\MyOpenClaw"

# 导入
.\import-agent.ps1 -InputPath "main-migration.zip" -AgentId "main" -OpenClawDir "D:\MyOpenClaw"
```

---

## 📝 脚本修改记录

| 日期 | 修改内容 |
|------|----------|
| 2026-03-31 | 初始版本 - 玛莉萝丝编写 |

---

*文档创建时间：2026-03-31*  
*作者：玛莉萝丝 (Marie Rose)* 👓🌹

# Agent 跃迁：合并与覆盖策略

> **分析时间**: 2026-03-31 11:11  
> **修正者**: 玛莉萝丝 (Marie Rose) 👓

---

## 🎯 核心原则

**主人说得对**：当目标端存在相同 Agent 时，**必须覆盖**，否则会导致配置不一致！

但需要**分层处理**：

| 层级 | 策略 | 说明 |
|------|------|------|
| **Agent 配置** | 🔴 覆盖 | `agents.list[agentId]` 相关配置 |
| **会话数据** | 🔴 覆盖 | `sessions.json`, `*.jsonl` |
| **工作区文件** | 🔴 覆盖 | `SOUL.md`, `MEMORY.md` 等 |
| **凭证配置** | 🟢 保留 | 目标端的 API Key、Token |
| **Channel 配置** | 🟡 合并 | 保留目标端的 Channel 凭证 |
| **全局配置** | 🟡 合并 | `agents.defaults.*` 等 |

---

## 📊 详细策略分析

### 场景 1：目标端存在同名 Agent

```
源端：main agent (from Laptop-A)
目标端：main agent (already exists on Laptop-B)
```

**处理策略**:

| 配置项 | 操作 | 原因 |
|--------|------|------|
| `agents.list[0]` (main) | 🔴 覆盖 | Agent 定义必须一致 |
| `agents.list[0].workspace` | 🔴 覆盖 | 工作区路径必须一致 |
| `bindings[]` (匹配 main) | 🔴 覆盖 | 路由规则必须一致 |
| `agents/main/agent/auth-profiles.json` | 🟢 保留 | 凭证是目标端的 |
| `agents/main/sessions/sessions.json` | 🔴 覆盖 | 会话索引必须一致 |
| `workspace/*` | 🔴 覆盖 | 工作区文件必须一致 |

**示例**:

```json
// 源端 openclaw.json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "workspace": "C:\\Users\\zheng\\.openclaw\\workspace",
        "name": "玛莉萝丝"
      }
    ]
  }
}

// 目标端 openclaw.json (导入前)
{
  "agents": {
    "list": [
      {
        "id": "main",
        "workspace": "/home/user/.openclaw/workspace",  // 路径不同
        "name": "Old Marie"  // 名字不同
      }
    ]
  }
}

// 目标端 openclaw.json (导入后)
{
  "agents": {
    "list": [
      {
        "id": "main",
        "workspace": "/home/user/.openclaw/workspace",  // ✅ 保留目标端路径 (因为文件系统不同)
        "name": "玛莉萝丝"  // 🔴 覆盖为源端名字
      }
    ]
  }
}
```

**注意**: `workspace` 路径需要根据目标端系统调整！

---

### 场景 2：目标端不存在同名 Agent

```
源端：momiji agent (from Laptop-A)
目标端：(不存在 on Laptop-B)
```

**处理策略**:

| 配置项 | 操作 | 原因 |
|--------|------|------|
| `agents.list[]` (新增 momiji) | 🟢 新增 | 添加新 Agent |
| `bindings[]` (匹配 momiji) | 🟢 新增 | 添加新路由 |
| `agents/momiji/` | 🟢 新增 | 创建完整目录 |
| `workspace-momiji/` | 🟢 新增 | 创建工作区 |

---

### 场景 3：凭证配置 (关键！)

```json
// 源端 openclaw.json
{
  "models": {
    "providers": {
      "openai": {
        "apiKey": "sk-source-12345"  // 源端的 Key
      }
    }
  },
  "channels": {
    "qqbot": {
      "accounts": {
        "marie_bot": {
          "appId": "102877854",
          "clientSecret": "source-secret"  // 源端的 Secret
        }
      }
    }
  }
}

// 目标端 openclaw.json (导入前)
{
  "models": {
    "providers": {
      "openai": {
        "apiKey": "sk-target-67890"  // 目标端的 Key
      }
    }
  },
  "channels": {
    "qqbot": {
      "accounts": {
        "marie_bot": {
          "appId": "102877854",
          "clientSecret": "target-secret"  // 目标端的 Secret
        }
      }
    }
  }
}

// 目标端 openclaw.json (导入后)
{
  "models": {
    "providers": {
      "openai": {
        "apiKey": "sk-target-67890"  // ✅ 保留目标端的 Key
      }
    }
  },
  "channels": {
    "qqbot": {
      "accounts": {
        "marie_bot": {
          "appId": "102877854",  // ✅ 保留 (配置一致)
          "clientSecret": "target-secret"  // ✅ 保留目标端的 Secret
        }
      }
    }
  }
}
```

**凭证保留列表**:

| 配置路径 | 策略 | 说明 |
|----------|------|------|
| `models.providers.*.apiKey` | 🟢 保留目标端 | API Key 是用户的 |
| `channels.*.token` | 🟢 保留目标端 | Bot Token 是用户的 |
| `channels.*.clientSecret` | 🟢 保留目标端 | OAuth Secret 是用户的 |
| `channels.*.accounts.*.clientSecret` | 🟢 保留目标端 | 同上 |
| `gateway.auth.token` | 🟢 保留目标端 | Gateway Token 是本地生成的 |
| `auth-profiles.json` 中的 token | 🟢 保留目标端 | OAuth Token 需要重新授权 |

---

## 🔄 配置合并算法

### 伪代码

```typescript
interface MergeOptions {
  strategy: 'overwrite' | 'merge' | 'skip';
  preserveCredentials: boolean;
  adjustPaths: boolean;
}

function mergeConfig(source: Config, target: Config, options: MergeOptions): Config {
  const result = { ...target };
  
  // 1. 凭证保留 (最高优先级)
  if (options.preserveCredentials) {
    result.models.providers = {
      ...source.models.providers,
      ...mapValues(target.models.providers, (provider, key) => ({
        ...provider,
        apiKey: provider.apiKey,  // 保留目标端 apiKey
      }))
    };
    
    result.channels = {
      ...source.channels,
      ...mapValues(target.channels, (channel, key) => ({
        ...channel,
        token: channel.token,  // 保留目标端 token
        accounts: mapValues(channel.accounts, (account) => ({
          ...account,
          clientSecret: account.clientSecret,  // 保留目标端 secret
        }))
      }))
    };
  }
  
  // 2. Agent 配置 (覆盖)
  for (const agent of source.agents.list) {
    const existingIndex = result.agents.list.findIndex(a => a.id === agent.id);
    
    if (existingIndex >= 0) {
      // 存在同名 Agent - 覆盖 (但保留 workspace 路径)
      result.agents.list[existingIndex] = {
        ...agent,
        workspace: result.agents.list[existingIndex].workspace,  // 保留目标端路径
      };
    } else {
      // 不存在 - 新增
      result.agents.list.push(agent);
    }
  }
  
  // 3. Bindings (合并)
  const sourceBindings = source.bindings || [];
  const targetBindings = target.bindings || [];
  
  // 过滤掉与源端 Agent 冲突的 bindings
  const filteredTargetBindings = targetBindings.filter(
    b => !sourceBindings.some(sb => 
      sb.agentId === b.agentId && 
      sb.match.channel === b.match.channel &&
      sb.match.accountId === b.match.accountId
    )
  );
  
  result.bindings = [...sourceBindings, ...filteredTargetBindings];
  
  // 4. 工作区文件 (覆盖)
  // 直接复制源端文件到目标端工作区
  
  return result;
}
```

---

## 📋 配置项分类表

### 🔴 覆盖类配置 (必须与源端一致)

| 配置路径 | 说明 | 例外 |
|----------|------|------|
| `agents.list[].id` | Agent ID | - |
| `agents.list[].name` | Agent 名称 | - |
| `agents.list[].workspace` | 工作区路径 | 根据目标端系统调整 |
| `agents.list[].agentDir` | Agent 目录 | 根据目标端系统调整 |
| `agents.list[].identity.*` | 身份配置 | - |
| `agents.list[].groupChat.*` | 群聊配置 | - |
| `agents.list[].sandbox.*` | 沙盒配置 | - |
| `agents.list[].tools.*` | 工具配置 | - |
| `bindings[]` | 路由绑定 | 同 key 覆盖 |
| `session.*` | 会话配置 | - |
| `session.dmScope` | DM 范围 | **关键！必须一致** |
| `session.maintenance.*` | 会话维护 | - |

### 🟢 保留类配置 (使用目标端值)

| 配置路径 | 说明 | 原因 |
|----------|------|------|
| `models.providers.*.apiKey` | 模型 API Key | 每个用户独立 |
| `models.providers.*.baseUrl` | 模型 API 地址 | 可能有自定义代理 |
| `channels.*.token` | Channel Token | 每个 Bot 独立 |
| `channels.*.clientSecret` | OAuth Secret | 每个应用独立 |
| `channels.*.accounts.*.appId` | 应用 ID | 需要目标端配置 |
| `channels.*.accounts.*.clientSecret` | 应用 Secret | 需要目标端配置 |
| `gateway.auth.token` | Gateway Token | 本地生成 |
| `gateway.auth.password` | Gateway 密码 | 本地设置 |
| `gateway.bind` | Gateway 绑定地址 | 网络环境不同 |
| `gateway.port` | Gateway 端口 | 可能冲突 |

### 🟡 合并类配置 (智能处理)

| 配置路径 | 策略 | 说明 |
|----------|------|------|
| `agents.defaults.*` | 源端优先，目标端补充 | 默认配置 |
| `tools.*` | 源端优先 | 工具配置 |
| `plugins.entries.*` | 合并 | 插件配置 |
| `skills.entries.*` | 合并 | 技能配置 |
| `hooks.*` | 源端优先 | Hook 配置 |
| `messages.*` | 源端优先 | 消息配置 |

---

## ⚠️ 特殊处理

### 1. 路径调整

```typescript
function adjustPaths(config: Config, targetOS: 'windows' | 'macos' | 'linux'): Config {
  return {
    ...config,
    agents: {
      ...config.agents,
      list: config.agents.list.map(agent => ({
        ...agent,
        workspace: agent.workspace
          ? convertPath(agent.workspace, targetOS)  // 转换路径分隔符
          : undefined,
        agentDir: agent.agentDir
          ? convertPath(agent.agentDir, targetOS)
          : undefined,
      }))
    }
  };
}

function convertPath(path: string, targetOS: string): string {
  // Windows: C:\Users\zheng\.openclaw\workspace
  // macOS/Linux: /Users/zheng/.openclaw/workspace
  
  const normalized = path.replace(/\\/g, '/');
  
  if (targetOS === 'windows') {
    return normalized.replace(/\//g, '\\');
  } else {
    return normalized;
  }
}
```

### 2. 凭证检测

```typescript
const CREDENTIAL_PATTERNS = [
  /apiKey$/i,
  /api_key$/i,
  /token$/i,
  /secret$/i,
  /password$/i,
  /clientSecret$/i,
  /client_secret$/i,
];

function isCredential(key: string): boolean {
  return CREDENTIAL_PATTERNS.some(pattern => pattern.test(key));
}

function mergeObject(source: any, target: any, preserveCredentials: boolean): any {
  const result = { ...source };
  
  for (const key of Object.keys(target)) {
    if (preserveCredentials && isCredential(key)) {
      // 保留目标端凭证
      result[key] = target[key];
    } else if (typeof target[key] === 'object' && typeof source[key] === 'object') {
      // 递归合并
      result[key] = mergeObject(source[key], target[key], preserveCredentials);
    } else {
      // 源端优先
      result[key] = source[key] ?? target[key];
    }
  }
  
  return result;
}
```

---

## 📝 导入流程 (修正版)

```
1. 用户执行：openclaw agent migrate import --source ./migration.zip
2. 下载并解压跃迁包
3. 验证 manifest 完整性
4. 检查目标端依赖 (channels, plugins, skills)
5. 读取目标端现有配置
6. 合并配置:
   a. 凭证保留 (目标端 API Keys, Tokens)
   b. Agent 配置覆盖 (同名 Agent)
   c. Agent 配置新增 (新 Agent)
   d. Bindings 合并 (去重)
   e. 路径调整 (根据目标端系统)
7. 恢复会话数据:
   - 复制 sessions.json (覆盖)
   - 复制 *.jsonl (可选)
8. 恢复工作区文件:
   - 创建/更新 workspace 目录 (覆盖)
   - 复制所有 Markdown 文件
9. 重建索引:
   - openclaw memory index --agent main --force
   - openclaw memory index --agent momiji --force
10. 提示用户重启 gateway
11. 提示用户配置凭证 (如果有缺失)
```

---

## ✅ 导入后验证

```bash
# 1. 验证配置合法性
openclaw config validate

# 2. 检查凭证配置
openclaw secrets audit --check

# 3. 验证 Agent 配置
openclaw agents list

# 4. 验证会话数据
openclaw sessions --json

# 5. 验证工作区文件
ls ~/.openclaw/workspace/

# 6. 测试消息续接
# 发送测试消息，检查是否在同一会话中
```

---

## 🎯 总结

主人是对的！Agent 跃迁的配置处理策略是：

| 配置类型 | 策略 | 原因 |
|----------|------|------|
| **Agent 核心配置** | 🔴 覆盖 | 确保 Agent 行为一致 |
| **会话数据** | 🔴 覆盖 | 确保会话连续性 |
| **工作区文件** | 🔴 覆盖 | 确保知识/记忆一致 |
| **凭证配置** | 🟢 保留 | 每个用户/环境独立 |
| **全局默认配置** | 🟡 合并 | 源端优先，目标端补充 |

**关键原则**:
1. **Agent 身份必须一致** — 否则消息路由会乱
2. **Session Key 必须一致** — 否则会话会断裂
3. **凭证必须保留目标端** — 否则无法连接 API
4. **路径需要适配目标端** — 否则文件找不到

---

*分析时间：2026-03-31 11:11*  
*修正者：玛莉萝丝 (Marie Rose)* 👓🌹

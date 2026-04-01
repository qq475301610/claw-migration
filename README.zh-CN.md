# Claw Migration

[English](./README.md) | [简体中文](./README.zh-CN.md)

`claw-migration` 是一个面向 OpenClaw 的插件包，提供迁移 CLI 和 skills。它围绕配置在 `openclaw.json` 中的远程 `push` / `pull` 工作流来运作。

## 安装形态

这个插件按 OpenClaw 插件包的方式组织：

- CLI 工具：`claw-migration`
- Skills：`skills/claw-migration/SKILL.md`
- Flake 导出：`openclawPlugin`

仓库中的 [flake.nix](/D:/workspace/my/claw-migration/flake.nix) 暴露了 `claw-migration-cli` 包和 `openclawPlugin` 定义。

## `openclaw.json` 配置

请把插件配置放在 `plugins.entries.claw-migration.config` 下。

```json
{
  "plugins": {
    "entries": {
      "claw-migration": {
        "enabled": true,
        "config": {
          "defaultRemote": "primary",
          "remotes": {
            "primary": {
              "provider": "github",
              "settings": {
                "gistId": "YOUR_SHARED_GIST_ID"
              }
            },
            "backup-webdav": {
              "provider": "webdav",
              "settings": {
                "baseUrl": "https://dav.example.com/openclaw/"
              }
            }
          },
          "transfer": {
            "includeTranscripts": false
          },
          "switchBindingsOnPush": true,
          "switchBindingsOnPull": true,
          "restartGatewayOnPush": true,
          "restartGatewayOnPull": true
        }
      }
    }
  }
}
```

说明：
- v1 目前只真正实现了 `github` provider。
- GitHub 认证从 `OPENCLAW_GITHUB_TOKEN`、`GITHUB_TOKEN` 或 `GH_TOKEN` 读取。
- `webdav` 目前只是保留配置形态，执行 `preview/push/pull` 时会明确阻断。

### 推荐的 GitHub 配置

在 v1 中，推荐把远程端配置成一个私有 GitHub Gist：

```json
{
  "plugins": {
    "entries": {
      "claw-migration": {
        "enabled": true,
        "config": {
          "defaultRemote": "github-main",
          "remotes": {
            "github-main": {
              "provider": "github",
              "settings": {
                "gistId": ""
              }
            }
          },
          "transfer": {
            "includeTranscripts": false
          },
          "switchBindingsOnPush": true,
          "switchBindingsOnPull": true,
          "restartGatewayOnPush": true,
          "restartGatewayOnPull": true
        }
      }
    }
  }
}
```

行为细节：
- 第一次 `push` 成功后，插件会创建一个私有 gist，并把返回的 `gistId` 写回 `openclaw.json`。
- 之后同一个 remote 会继续更新这个 gist。
- `pull` 要求所选 remote 已经有 `gistId`。
- 插件只会禁用或重新启用指定 agent 的 bindings，不会直接停掉整个 channel account。

## CLI

```bash
claw-migration preview push --agent main
claw-migration push --agent main
claw-migration preview pull --agent main
claw-migration pull --agent main --yes
claw-migration verify --agent main
```

常用参数：
- `--remote <name>`：覆盖 `defaultRemote`
- `--openclaw-dir <path>`：覆盖默认的 `~/.openclaw`
- `--skip-reindex`：`pull` 后跳过 memory index 重建
- `--notes <text>`：给 push 的 manifest 附加备注
- `--input <file>`：验证本地 zip，而不是远程包

## 工作流语义

- `preview push`：检查本地 agent 状态、remote 配置、将要上传的包、将要停用的 bindings，以及是否会重启 gateway。
- `push`：上传迁移包；如果配置允许，则停用当前 agent 的 bindings，并重启 gateway。
- `preview pull`：下载远程包，预览导入影响，并报告 bindings / gateway 动作，不写入状态。
- `pull`：导入迁移包；如果配置允许，则重新启用当前 agent 的 bindings，并重启 gateway。
- `verify`：校验本地 zip 或远程包的 manifest / checksum。

## GitHub 设置

1. 创建一个可以创建和更新私有 gist 的 GitHub token。
2. 在执行 CLI 前导出以下任一环境变量：
   - `OPENCLAW_GITHUB_TOKEN`
   - `GITHUB_TOKEN`
   - `GH_TOKEN`
3. 把上面的插件配置块写入设备上的 `openclaw.json`。
4. 第一次正式 `push` 之前，先运行 `claw-migration preview push --agent <id>`。

## 双设备操作流程

### 源设备

源设备是当前持有活跃 agent 状态的那台机器。

1. 确认 `plugins.entries.claw-migration.config` 已存在，并指向 GitHub remote。
2. 把 GitHub token 导出到环境变量。
3. 运行：
   ```bash
   claw-migration preview push --agent main
   claw-migration push --agent main
   ```
4. 成功后：
   - 迁移包会上传到私有 gist
   - 指定 agent 的 bindings 会按配置被停用
   - gateway 会按配置重启
   - 如果这是第一次 push，`gistId` 会写回 `openclaw.json`

### 目标设备

目标设备是准备接管这个 agent 的那台机器。

1. 在目标设备上复制或重新写入同样的 `claw-migration` 插件配置块。
2. 确认所选 remote 已经带有正确的 `gistId`。
3. 把同一个 GitHub token 导出到环境变量。
4. 运行：
   ```bash
   claw-migration preview pull --agent main
   claw-migration pull --agent main --yes
   ```
5. 成功后：
   - 远程迁移包会被下载
   - agent 配置、sessions 和 workspace 会被导入
   - 指定 agent 的 bindings 会按配置被重新启用
   - gateway 会按配置重启

### 推荐切换顺序

如果你想做最稳妥的单 agent 交接：

1. 在源设备执行 `preview push`
2. 在源设备执行 `push`
3. 确认源设备上的 bindings 已停用
4. 在目标设备执行 `preview pull`
5. 在目标设备执行 `pull --yes`
6. 确认目标设备上的 bindings 已启用，且 gateway 已正常重启

## Skills

插件 skill 在 [skills/claw-migration/SKILL.md](/D:/workspace/my/claw-migration/skills/claw-migration/SKILL.md)。它的设计目标是让 Agent：

1. 从 `openclaw.json` 读取插件配置
2. 在 `push` 或 `pull` 前先做 `preview`
3. 如果有 blocker，就停止并汇报，而不是直接写入
4. 成功后总结 remote、bindings 和 gateway 的结果

## 测试

```bash
npm test
```

## 更多说明

仓库里还有一份 GitHub provider 的操作手册：[docs/github-provider-guide.md](/D:/workspace/my/claw-migration/docs/github-provider-guide.md)。

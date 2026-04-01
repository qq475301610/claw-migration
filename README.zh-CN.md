# Claw Migration

[English](./README.md) | [简体中文](./README.zh-CN.md)

`claw-migration` 是一个面向 OpenClaw 的插件包，用来通过远程包存储在不同设备之间迁移单个 agent。

它的目标流程是：
- 在源设备上把当前 agent 状态 `push` 到 GitHub
- 自动停用源设备上这个 agent 的 bindings
- 在目标设备上从 GitHub `pull` 迁移包
- 自动恢复 agent、重新启用 bindings，并按配置重启 gateway

## 项目作用

这个项目解决的是“如何把一个 OpenClaw agent 从一台设备切换到另一台设备，而不需要手工复制一堆状态文件”的问题。

核心能力：
- 把单个 agent 的配置、sessions、workspace 打包成迁移 zip
- 把迁移包存储到私有 GitHub Gist
- 提供 preview-first 的 `push` / `pull` 工作流
- 自动切换指定 agent 的 bindings
- 按配置在交接后重启 gateway
- 同时提供 CLI 和 skill 两种使用方式

当前范围：
- 只支持单个 agent 的迁移
- 当前只实现了 GitHub provider
- WebDAV 只保留扩展位，暂未实现
- 迁移包是完整包，不是脱敏分享包

## 快速开始

### 1. 安装和准备

这个仓库按 OpenClaw 插件包的方式组织：
- CLI 工具：`claw-migration`
- Skill：`skills/claw-migration/SKILL.md`
- Flake 导出：`openclawPlugin`

仓库中的 [flake.nix](/D:/workspace/my/claw-migration/flake.nix) 暴露了 `claw-migration-cli` 包和 `openclawPlugin` 定义。

### 2. 配置 `openclaw.json`

把插件配置写到 `plugins.entries.claw-migration.config` 下。

推荐的 v1 GitHub 配置：

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

重要说明：
- v1 目前只实现了 `github` provider
- GitHub 认证从 `OPENCLAW_GITHUB_TOKEN`、`GITHUB_TOKEN` 或 `GH_TOKEN` 读取
- 第一次 `push` 成功后，插件会创建私有 gist，并把返回的 `gistId` 写回 `openclaw.json`
- 后续 `push` 会继续更新同一个 gist
- `pull` 要求所选 remote 已经存在 `gistId`

### 3. 导出 GitHub Token

在执行 CLI 前，导出以下任一环境变量：
- `OPENCLAW_GITHUB_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`

这个 token 需要具备创建和更新私有 gist 的能力。

### 4. 执行迁移流程

源设备：

```bash
claw-migration preview push --agent main
claw-migration push --agent main
```

目标设备：

```bash
claw-migration preview pull --agent main
claw-migration pull --agent main --yes
```

## 安装说明

这个项目的目标形态是 OpenClaw 插件包，但实际给用户使用的入口是 `claw-migration` CLI。

仓库关键文件：
- [package.json](/D:/workspace/my/claw-migration/package.json)
- [flake.nix](/D:/workspace/my/claw-migration/flake.nix)
- [skills/claw-migration/SKILL.md](/D:/workspace/my/claw-migration/skills/claw-migration/SKILL.md)
- [.codex-plugin/plugin.json](/D:/workspace/my/claw-migration/.codex-plugin/plugin.json)

## 使用说明

### CLI 命令

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
- `--notes <text>`：给 push 的 manifest 添加备注
- `--input <file>`：验证本地 zip，而不是远程包

### 各命令的作用

- `preview push`：检查本地 agent 状态、remote 配置、包生成、bindings 停用动作，以及 gateway 重启计划
- `push`：上传迁移包；如果配置允许，则停用所选 agent 的 bindings，并重启 gateway
- `preview pull`：下载远程包，预览导入影响，并展示 bindings / gateway 动作，但不写入
- `pull`：导入远程包；如果配置允许，则重新启用所选 agent 的 bindings，并重启 gateway
- `verify`：验证本地 zip 或远程包的 manifest 和 checksum

### 源设备 / 目标设备操作流程

#### 源设备

在当前持有活跃 agent 状态的设备上执行：

1. 确认 `plugins.entries.claw-migration.config` 指向正确的 GitHub remote
2. 导出 GitHub token
3. 运行：
   ```bash
   claw-migration preview push --agent main
   claw-migration push --agent main
   ```
4. 成功后：
   - 迁移包会上传到私有 gist
   - 指定 agent 的 bindings 会按配置被停用
   - gateway 会按配置重启
   - 第一次 push 会把 `gistId` 写回 `openclaw.json`

#### 目标设备

在准备接管 agent 的设备上执行：

1. 在 `openclaw.json` 中复制或重建同样的插件配置
2. 确认所选 remote 已有正确的 `gistId`
3. 导出同一个 GitHub token
4. 运行：
   ```bash
   claw-migration preview pull --agent main
   claw-migration pull --agent main --yes
   ```
5. 成功后：
   - 远程迁移包会被下载
   - agent 配置、sessions、workspace 会被导入
   - 指定 agent 的 bindings 会按配置重新启用
   - gateway 会按配置重启

#### 推荐交接顺序

1. 在源设备执行 `preview push`
2. 在源设备执行 `push`
3. 确认源设备上的 bindings 已停用
4. 在目标设备执行 `preview pull`
5. 在目标设备执行 `pull --yes`
6. 确认目标设备上的 bindings 已启用，并且 gateway 已正常重启

## Skill 用法

插件 skill 在 [skills/claw-migration/SKILL.md](/D:/workspace/my/claw-migration/skills/claw-migration/SKILL.md)。

它的目标是让 Agent：
1. 从 `openclaw.json` 读取插件配置
2. 在 `push` 或 `pull` 前先做 `preview`
3. 如果有 blocker，就停止并汇报，而不是强行写入
4. 成功后总结 remote、bindings 和 gateway 的结果

## 测试

```bash
npm test
```

## 更多文档

- GitHub provider 操作说明：[docs/github-provider-guide.md](/D:/workspace/my/claw-migration/docs/github-provider-guide.md)

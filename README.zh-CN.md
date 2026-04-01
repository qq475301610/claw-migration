# Claw Migration

[English](./README.md) | [简体中文](./README.zh-CN.md)

`claw-migration` 是一个 OpenClaw 插件和配套 CLI，用来把单个 agent 从一台设备迁移到另一台设备。

它会把目标 agent 的配置、sessions 和 workspace 打成迁移包，上传到 GitHub，然后让目标设备以 preview-first 的方式拉取回来。交接成功后，它还可以自动关闭源设备上的 bindings、关闭对应的 QQBot 账号、在目标设备重新启用它们，并按配置重启 gateway。

## 这个项目是做什么的

适合下面这些场景：
- 想把一个 OpenClaw agent 切到另一台设备，但不想手工拷整个 `.openclaw`
- 想把 agent 的 workspace、会话历史、agent 本地配置一起迁走
- 想通过 GitHub 远程对象在两台机器之间做交接
- 想自己跑 CLI，也想让 OpenClaw Agent 通过 skill 帮你执行迁移

当前范围：
- 只支持单个 agent 迁移
- 当前只实现了 GitHub provider
- WebDAV 只预留了扩展位，暂未实现
- 迁移包是完整包，不是脱敏分享包

## 从源码安装

### 1. 下载源码

```bash
git clone https://github.com/qq475301610/claw-migration.git
cd claw-migration
```

### 2. 安装依赖

环境要求：
- Node.js 20 或更高版本
- npm
- 这台机器已经安装并能运行 OpenClaw

```bash
npm install
```

当前这个项目没有单独的 build 步骤，可以直接从源码运行。

可选自检：

```bash
npm test
```

### 3. 把插件注册到 OpenClaw

这一步会让 OpenClaw 真正识别 `claw-migration`。

```bash
openclaw plugins install -l .
```

可选检查：

```bash
openclaw plugins list
```

插件首次被加载时，会自动往 `~/.openclaw/openclaw.json` 里 seed 一份默认配置块。

### 4. 运行交互式配置

推荐配置方式：

```bash
claw-migration setup
```

这个命令会引导你填写：
- remote 名称
- 稳定的 `remoteKey`
- GitHub token，并直接写入 `openclaw.json`
- 是否带 transcripts
- push/pull 后是否切换 bindings
- push/pull 后是否重启 gateway

### 5. 选择 CLI 的运行方式

方式 A：直接在仓库里运行

```bash
node ./bin/claw-migration.js preview push --agent main
```

方式 B：把命令安装到当前机器，方便直接调用

```bash
npm link
claw-migration --help
```

## 配置模型

插件配置在：
- `~/.openclaw/openclaw.json`
- `plugins.entries.claw-migration.config`

现在更推荐的 GitHub 配置长这样：

```json
{
  "plugins": {
    "entries": {
      "claw-migration": {
        "enabled": true,
        "config": {
          "defaultRemote": "main-agent",
          "remotes": {
            "main-agent": {
              "provider": "github",
              "settings": {
                "remoteKey": "main-agent",
                "token": "ghp_xxx"
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
- `remoteKey` 是 GitHub 远程的主标识
- `gistId` 现在更像内部缓存，push/pull 后可能被自动写回
- GitHub token 可以直接存到 `remotes.<name>.settings.token`
- 环境变量依然支持，但只作为兜底，不再是主流程

## GitHub Token

推荐方式：
- 直接执行 `claw-migration setup`
- 按提示粘贴 GitHub token
- 让插件把它写入 `openclaw.json`

兜底方式：
- `OPENCLAW_GITHUB_TOKEN`
- `GITHUB_TOKEN`
- `GH_TOKEN`

这个 token 需要具备创建和更新 private gist 的权限。

### 去哪里获取 Token

1. 打开 GitHub。
2. 进入 `Settings -> Developer settings -> Personal access tokens`。
3. 任选一种方式创建：
- classic token，并勾选 `gist` scope
- fine-grained token，并给 `User permissions -> Gists` 写权限

GitHub 官方说明：
- [Managing your personal access tokens](https://docs.github.com/github/extending-github/git-automation-with-oauth-tokens)
- [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)

## 快速使用

如果你没有执行 `npm link`，下面命令里的 `claw-migration` 都可以替换成 `node ./bin/claw-migration.js`。推荐优先使用 `claw-migration setup`，因为有些 OpenClaw 构建不会把插件子命令注入到主 CLI 里。

### 源设备

推荐首次使用流程：

```bash
openclaw plugins install -l .
claw-migration setup
claw-migration preview push --agent main
claw-migration push --agent main
```

`push` 成功后会发生：
- 为对应 `remoteKey` 创建或更新 GitHub gist
- 按配置停用该 agent 的 bindings
- 如果绑定的是 `qqbot`，会把对应 `qqbot.accounts.<accountId>.enabled` 设为 `false`
- 按配置重启 gateway
- `gistId` 会作为缓存回写到 `openclaw.json`

### 目标设备

执行 `pull` 之前，请确认目标设备已经完成：
- 已执行 `openclaw plugins install -l .`
- 已通过 `claw-migration setup` 配好同样的 `remoteKey`
- 已在 `openclaw.json` 里配置 GitHub token，或提供了环境变量兜底

然后执行：

```bash
claw-migration preview pull --agent main
claw-migration pull --agent main --yes
```

`pull` 成功后会发生：
- 下载远程迁移包
- 导入 agent 配置、sessions 和 workspace
- 按配置重新启用该 agent 的 bindings
- 如果绑定的是 `qqbot`，会把对应 account 恢复成可用状态
- 按配置重启 gateway

## 命令说明

```bash
claw-migration setup
claw-migration preview push --agent <id>
claw-migration push --agent <id>
claw-migration preview pull --agent <id>
claw-migration pull --agent <id> --yes
claw-migration verify --agent <id>
```

常用参数：
- `--remote <name>`：覆盖 `defaultRemote`
- `--openclaw-dir <path>`：覆盖默认的 `~/.openclaw`
- `--skip-reindex`：`pull` 后跳过 memory index 重建
- `--notes <text>`：给 push 的 manifest 添加备注
- `--input <file>`：校验本地 zip，而不是远程包

## OpenClaw Skill 用法

内置 skill 在 [skills/claw-migration/SKILL.md](./skills/claw-migration/SKILL.md)。

插件安装完成后，Agent 可以通过这个 skill：
1. 读取 `plugins.entries.claw-migration.config`
2. 在 `push` 或 `pull` 前先执行 preview
3. 遇到 blocker 时停止，而不是强行写入
4. 成功后总结 remote、bindings、qqbot 账号状态和 gateway 动作

## 让 OpenClaw 识别这个仓库的关键文件

下面这些文件共同组成了 OpenClaw 原生插件包：
- [openclaw.plugin.json](./openclaw.plugin.json)
- [package.json](./package.json)
- [src/index.js](./src/index.js)
- [src/setup-cli.js](./src/setup-cli.js)
- [skills/claw-migration/SKILL.md](./skills/claw-migration/SKILL.md)

## 测试

```bash
npm test
```

## 更多文档

- GitHub provider 操作说明：[docs/github-provider-guide.md](./docs/github-provider-guide.md)

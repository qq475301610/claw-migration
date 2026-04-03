# Claw Migration

[English](./README.md) | [简体中文](./README.zh-CN.md)

`claw-migration` 是一个 OpenClaw 插件和配套 CLI，用来把单个 agent 从一台设备迁移到另一台设备。

它会把目标 agent 的配置、sessions 和 workspace 打成迁移包，上传到 GitHub，然后让目标设备以 preview-first 的方式拉取回来。交接成功后，它还可以自动关闭源设备上的 bindings、关闭支持 `enabled` 开关的 channel 账号或 channel 本身，并在目标设备重新启用它们。

## 这个项目是做什么的

适合下面这些场景：
- 想把一个 OpenClaw agent 切到另一台设备，但不想手工拷整个 `.openclaw`
- 想把 agent 的 workspace、会话历史、agent 本地配置一起迁走
- 想通过 GitHub 远程对象在两台机器之间做交接
- 想自己跑 CLI，也想让 OpenClaw Agent 通过 skill 帮你执行迁移

当前范围：
- 只支持单个 agent 迁移
- 当前只实现了 GitHub Release Assets provider
- WebDAV 只预留了扩展位，暂未实现
- 迁移包是完整包，不是脱敏分享包
- channel 状态恢复同时支持官方 OpenClaw channel 风格配置和 `openclaw-china` 插件里的 channel 配置

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
claw-migration doctor
```

这个命令会引导你填写：
- remote 名称
- GitHub owner
- GitHub repo
- 稳定的 `remoteKey`
- GitHub token，并直接写入 `openclaw.json`
- 是否带 transcripts
- push/pull 后是否切换 bindings

执行完后，`claw-migration doctor` 会检查内置 skill 是否存在，以及 `~/.openclaw/skills/claw-migration` 下是否已经有共享安装。如果新会话里仍然看不到 skill，可以执行 `claw-migration install-skill`。

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

### GitHub 字段怎么填

当 `claw-migration setup` 提示你填写 GitHub 字段时，可以这样理解：
- `GitHub owner`：GitHub 用户名或组织名。例如 `qq475301610` 或 `my-team`。
- `GitHub repo`：专门用来存迁移包 Release Assets 的仓库名。例如 `claw-migration-store`。
- `GitHub token`：一个有权限在该仓库创建 Release、上传 Release Assets 的 Personal Access Token。

推荐准备方式：
1. 先决定迁移文件是放在你的个人 GitHub 账号下，还是某个组织下。
2. 新建一个专门存迁移包的仓库，例如 `claw-migration-store`。
3. 把账号名或组织名填到 `owner`。
4. 把仓库名填到 `repo`。
5. 去 `GitHub -> Settings -> Developer settings -> Personal access tokens` 创建 token，然后在 setup 时粘贴进去。

推荐的仓库使用方式：
- 最好单独建一个 private 仓库专门存迁移包
- 除非你明确想把迁移 zip 也放到插件源码仓库里，否则不要直接复用当前源码仓库
- 仓库不能是空仓库，至少先有一个初始提交，例如 `README.md`
- 源设备和目标设备应配置相同的 `owner` 和 `repo`

推荐的 GitHub 配置示例：

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
                "owner": "your-github-user-or-org",
                "repo": "claw-migration-store",
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
- `releaseId` 现在更像内部缓存，push/pull 后可能被自动写回
- 用户真正应该关心和配置的是 `remoteKey`，而不是 `releaseId`
- GitHub token 可以直接存到 `remotes.<name>.settings.token`
- GitHub token 现在只从 `remotes.<name>.settings.token` 读取

### `remoteKey` 和 `releaseId` 的区别

这两个字段是故意分开的：
- `remoteKey`：你自己控制的稳定标识，用来表示“这是哪一个迁移槽位”
- `releaseId`：GitHub 返回的内部数字 ID，只作为本地缓存

实际使用时：
- 源设备和目标设备应配置相同的 `remoteKey`
- 即使没有 `releaseId`，插件也可以通过 `remoteKey` 找到正确的 GitHub release
- 即使 `releaseId` 变化或丢失，通常也不需要你手工修复

## GitHub Token 与权限

推荐方式：
- 直接执行 `claw-migration setup`
- 按提示粘贴 GitHub token
- 让插件把它写入 `openclaw.json`


去哪里获取 `owner`、`repo` 和 `token`：
1. 打开准备用来存迁移文件的 GitHub 账号或组织页面。
2. 新建一个仓库，例如 `claw-migration-store`。
3. 把账号名或组织名作为 `owner`。
4. 把仓库名作为 `repo`。
5. 再进入 `Settings -> Developer settings -> Personal access tokens` 创建 token。

这个 token 需要满足：
- 能访问你配置的仓库
- 能创建 Release
- 能上传和替换 Release Assets
- 如果仓库是 private，权限不足时 GitHub 可能返回 `404 Not Found`

推荐的 fine-grained token 配置方式：
1. 打开 `Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens`
2. `Resource owner` 选择正确的账号或组织
3. `Repository access` 选择目标仓库，例如 `claw-migration-store`
4. `Repository permissions` 至少给 `Contents: Read and write`
5. 生成 token，并粘贴到 setup

如果你使用 classic token，也必须保证它对目标仓库具备足够的仓库访问权限，能够创建 Release 和上传资产。

GitHub 侧常见错误：
- 仓库还没创建
- `owner` 对了，但 `repo` 填错了
- 仓库是 private，但 token 不能访问它
- 仓库是空仓库，GitHub release 至少要求仓库里有一个 commit
- 把 `owner` 或 `repo` 写成了完整 URL，而不是名字

GitHub 官方说明：
- [Managing your personal access tokens](https://docs.github.com/github/extending-github/git-automation-with-oauth-tokens)
- [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
- [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

## 快速使用

如果你没有执行 `npm link`，下面命令里的 `claw-migration` 都可以替换成 `node ./bin/claw-migration.js`。

### 源设备

```bash
openclaw plugins install -l .
claw-migration setup
claw-migration doctor
claw-migration install-skill   # 只有在新会话里仍然看不到 skill 时才需要
claw-migration preview push --agent main
claw-migration push --agent main
```

`push` 成功后会发生：
- 为对应 `remoteKey` 创建或更新 GitHub Release Asset
- 按配置停用该 agent 的 bindings
- 如果绑定的是受支持 channel，会把对应账号或 channel 的 `enabled` 设为 `false`
- `releaseId` 会作为缓存回写到 `openclaw.json`
- 不会手动重启 gateway

### 目标设备

执行 `pull` 之前，请确认目标设备已经完成：
- 已执行 `openclaw plugins install -l .`
- 已通过 `claw-migration setup` 配好相同的 `owner`、`repo` 和 `remoteKey`
- 已在 `openclaw.json` 里配置 GitHub token
- 如果新会话里仍然看不到 skill，可执行 `claw-migration install-skill` 安装共享 fallback

然后执行：

```bash
claw-migration preview pull --agent main
claw-migration pull --agent main --yes
```

`pull` 成功后会发生：
- 下载远程迁移包
- 导入 agent 配置、sessions 和 workspace
- 按配置重新启用该 agent 的 bindings
- 如果绑定的是受支持 channel，会把对应账号或 channel 恢复成可用状态
- 不会手动重启 gateway

## 命令说明

可用命令：

```bash
claw-migration setup
claw-migration doctor [--openclaw-dir <path>]
claw-migration install-skill [--openclaw-dir <path>]
claw-migration preview push --agent <id> [--remote <name>] [--openclaw-dir <path>] [--notes <text>] [--quiet]
claw-migration push --agent <id> [--remote <name>] [--openclaw-dir <path>] [--notes <text>] [--quiet]
claw-migration preview pull --agent <id> [--remote <name>] [--openclaw-dir <path>] [--quiet]
claw-migration pull --agent <id> [--remote <name>] [--openclaw-dir <path>] [--skip-reindex] [--yes] [--quiet]
claw-migration verify --agent <id> [--remote <name>] [--openclaw-dir <path>] [--input <file>] [--quiet]
```

### setup

`claw-migration setup` 会打开交互式配置向导。

它会做什么：
- 在 `~/.openclaw/openclaw.json` 中创建或更新 `plugins.entries.claw-migration.config`
- 让你选择 remote 名称、GitHub owner、GitHub repo 和稳定的 `remoteKey`
- 把 GitHub token 写入插件配置
- 设置迁移和 gateway 的行为开关

常用参数：
- `--openclaw-dir <path>`：改用其他 OpenClaw 状态目录，而不是默认的 `~/.openclaw`

### doctor

`claw-migration doctor` 用来检查内置 skill 是否存在，以及 `~/.openclaw/skills/claw-migration` 下是否已经安装了共享 skill。

它会做什么：
- 校验仓库内的 `skills/claw-migration/SKILL.md` 是否存在
- 检查 `~/.openclaw/skills/claw-migration` 下是否已有共享副本
- 告诉你当前是否建议执行 fallback 安装命令

参数说明：
- `--openclaw-dir <path>`：可选；改用其他 OpenClaw 状态目录

### install-skill

`claw-migration install-skill` 会把内置 skill 复制到 `~/.openclaw/skills/claw-migration`。

它会做什么：
- 只复制当前插件自己的 `claw-migration` skill
- 如果共享目录里已有旧版本，则直接覆盖更新
- 打印源路径、目标路径和是否发生覆盖
- 提示你如果没有立刻看到 skill，可以新开一个会话

参数说明：
- `--openclaw-dir <path>`：可选；改用其他 OpenClaw 状态目录

### preview push

`claw-migration preview push --agent <id>` 用来预览本次导出和上传会做什么。

它会做什么：
- 校验目标 agent 是否存在
- 解析当前使用的 remote
- 构建迁移包和 manifest
- 展示哪些 bindings 会被停用
- 不上传，也不写任何状态

参数说明：
- `--agent <id>`：必填；要导出的 agent
- `--remote <name>`：可选；本次运行临时覆盖 `defaultRemote`
- `--openclaw-dir <path>`：可选；改用其他 OpenClaw 状态目录
- `--notes <text>`：可选；给生成的 manifest 附加备注
- `--quiet`：可选；隐藏进度输出

### push

`claw-migration push --agent <id>` 会导出 agent，并把迁移包上传到配置好的 GitHub 远程。

它会做什么：
- 生成迁移包
- 根据 `remoteKey` 创建或更新对应的 GitHub Release Asset
- 把最新远程包 id 回写到插件配置里
- 按配置在源设备停用这个 agent 的 bindings
- 如适用，停用关联 channel 的账号或根级 `enabled` 开关
- 不会手动重启 gateway

参数说明：
- `--agent <id>`：必填；要导出的 agent
- `--remote <name>`：可选；临时覆盖 `defaultRemote`
- `--openclaw-dir <path>`：可选；改用其他 OpenClaw 状态目录
- `--notes <text>`：可选；给 push 的 manifest 添加备注
- `--quiet`：可选；隐藏进度输出

### preview pull

`claw-migration preview pull --agent <id>` 会下载远程迁移包，并展示本次导入将会发生什么。

它会做什么：
- 通过 `remoteKey` 或缓存的 `releaseId` 定位远程包
- 下载并校验迁移包
- 检查依赖的 plugins 和 skills
- 展示哪些配置、sessions 和 workspace 文件会被覆盖
- 不写任何状态

参数说明：
- `--agent <id>`：必填；要导入到本机哪个 agent 槽位
- `--remote <name>`：可选；临时覆盖 `defaultRemote`
- `--openclaw-dir <path>`：可选；改用其他 OpenClaw 状态目录
- `--quiet`：可选；隐藏进度输出

### pull

`claw-migration pull --agent <id>` 会把远程迁移包真正导入到目标设备。

它会做什么：
- 在内部先执行与 preview 相同的校验
- 导入配置、sessions 和 workspace
- 按配置重新启用这个 agent 的 bindings
- 如适用，重新启用关联 channel 的账号或根级 `enabled` 开关
- 不会手动重启 gateway

参数说明：
- `--agent <id>`：必填；要导入到本机哪个 agent 槽位
- `--remote <name>`：可选；临时覆盖 `defaultRemote`
- `--openclaw-dir <path>`：可选；改用其他 OpenClaw 状态目录
- `--skip-reindex`：可选；导入后跳过 memory index 重建
- `--yes`：可选；跳过交互确认，只要 preview 校验通过就直接执行导入
- `--quiet`：可选；隐藏进度输出

关于 `--yes` 的重要说明：
- 不带 `--yes` 时，`pull` 会先打印 preview，然后停下来问你是否继续
- 带上 `--yes` 时，`pull` 仍然会在内部做 preview 校验，但不会再停下来等待确认

### verify

`claw-migration verify --agent <id>` 用来校验迁移包，但不会执行导入。

它会做什么：
- 检查必须文件和 checksum
- 可以校验远程包，也可以校验本地 zip
- 不写任何状态

参数说明：
- `--agent <id>`：校验远程包时必填；用于检查目标包结构
- `--remote <name>`：可选；校验远程包时临时覆盖 `defaultRemote`
- `--openclaw-dir <path>`：可选；改用其他 OpenClaw 状态目录
- `--input <file>`：可选；改为校验本地 zip，而不是从远程下载
- `--quiet`：可选；隐藏进度输出

### 共享参数汇总

- `--agent <id>`：指定要导出或导入的单个 agent
- `--remote <name>`：指定本次命令使用 `plugins.entries.claw-migration.config.remotes` 下的哪个 remote
- `--openclaw-dir <path>`：让 CLI 指向另一个 OpenClaw home 目录
- `--notes <text>`：在 push 时把人类可读备注写进 manifest
- `--skip-reindex`：在 pull 后跳过 memory index 重建，适合想更快完成导入时使用
- `--input <file>`：让 `verify` 校验本地包文件，而不是 GitHub 远程
- `--yes`：给 `pull` 使用的非交互确认参数
- `--quiet`：关闭下载、解压等阶段的进度输出

## Channel 支持范围

`push` 和 `pull` 时的 channel 状态切换，不再只针对 `qqbot`。

当前支持：
- 官方 OpenClaw channel 风格配置，只要它暴露 `channels.<channel>.enabled` 或 `channels.<channel>.accounts.<accountId>.enabled`
- `openclaw-china` 插件里的 channel 集合，包括 `dingtalk`、`feishu-china`、`qqbot`、`wechat-mp`、`wecom`、`wecom-app`、`wecom-kf`

当迁移的 agent 绑定到了这些受支持 channel 时，`push` 会在源设备停用对应账号或 channel，`pull` 会在目标设备恢复它们。

## OpenClaw Skill 用法

内置 skill 在 [skills/claw-migration/SKILL.md](./skills/claw-migration/SKILL.md)。

Skill 查找优先级遵循 OpenClaw 官方文档：
- `<workspace>/skills`
- `<workspace>/.agents/skills`
- `~/.agents/skills`
- `~/.openclaw/skills`
- bundled skills

推荐顺序：
1. `openclaw plugins install -l .`
2. `claw-migration setup`
3. 如果新会话里仍然看不到 skill，再执行 `claw-migration install-skill`

插件安装完成后，Agent 可以通过这个 skill：
1. 读取 `plugins.entries.claw-migration.config`
2. 在 `push` 或 `pull` 前先执行 preview
3. 遇到 blocker 时停止，而不是强行写入
4. 成功后总结 remote、bindings、channel 账号状态和 gateway 动作

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

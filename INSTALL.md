# 安装 learning-mode（学习模式）插件

三种方式，任选一种。装完都要**完全退出并重启 DeepSeek Desktop**（Host 半区的代码在重启后才加载）。

## 方式 A：图形界面（推荐，最省事）

1. 解压本压缩包到任意目录（例如 `D:\dsh-plugins\`）。
2. 打开 DeepSeek Desktop → 侧边栏 **插件** → **添加插件**。
3. 粘贴 `learning-mode` 目录的**绝对路径**，例如：

   ```text
   D:\dsh-plugins\learning-mode
   ```

4. 点安装，然后**完全退出并重启** DeepSeek Desktop。
5. 侧边栏底部出现「学习模式」图标即成功。

> 插件页接受包名 / Git 地址 / 压缩包 / **本地绝对路径**，这里用最后一种。

## 方式 B：脚本（PowerShell）

```powershell
# 在本压缩包解压后的目录里执行
pwsh -File .\install.ps1                 # 默认安装到 desktop profile
pwsh -File .\install.ps1 -Profile web    # 指定其它 profile
pwsh -File .\install.ps1 -DshHome D:\dsh-home
```

脚本做的事：把 `learning-mode/` 复制进 `<DSH_HOME>/profiles/<profile>/node_modules/@local/`，并在该 profile 的 `package.json` 里登记依赖与 `dsh.profile.bundles`。原文件会先备份为 `package.json.bak-learning-mode`。

## 方式 C：macOS / Linux 脚本

```bash
./install.sh              # 默认 desktop profile
./install.sh web          # 指定 profile
DSH_HOME=~/.dsh ./install.sh
```

需要 `python3`（用于安全地改 profile 的 `package.json`）。

## 方式 D：`.dspack` 整合包（有 PackForge 插件时）

若目标设备装了 `@dsh-packforge/dsh-pack-plugin`：用它的设置面板「安装 .dspack」选择
`dsh-learning-mode-0.1.0.dspack` 即可（校验 sha256 后落位）。这条路径依赖 PackForge 的安装器，
**推荐优先用方式 A**。

## 验证安装

```powershell
# 1) 包是否就位
Test-Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@local\learning-mode\client.js"

# 2) 重启后看宿主激活日志（成功会有 apply.start / tool.registered）
Get-Content "$env:USERPROFILE\.dsh\learning-mode.log" -Tail 5
```

日志里应出现：

```json
{"event":"apply.start","hasTools":true,"hasSystemPrompt":true}
{"event":"tool.registered","name":"learning_control"}
{"event":"prompt.section.registered","order":1500}
```

## 第一次使用

在**新建会话**里（工作目录含 `learning/`）说「继续」，agent 会调用 `learning_control` 只讲当前一步。
没有知识库时，点侧边栏「学习模式」→「导入文献」→ 粘贴文献绝对路径，agent 会先给出步骤 DAG 草案。

## 卸载

删掉 `<DSH_HOME>/profiles/<profile>/node_modules/@local/learning-mode`，并从该 profile 的
`package.json` 中移除 `dependencies["@local/learning-mode"]` 与 `dsh.profile.bundles` 里的
`"@local/learning-mode"`，然后重启应用。

# 发布清单（dsh-learning-mode）

仓库：`IcinessLove/dsh-learning-mode` ｜ 当前版本 `0.1.1` ｜ tag `v0.1.1`

**状态：v0.1.0 与 v0.1.1 均已发布** ✓

**本仓库不参与 dspack 市场收录** ✓ —— 已撤出 `dsh-pack` 话题。采集器按 `search/repositories?q=topic:dsh-pack` 扫描，撤话题即退出（采集器源码注释：「目录只在撤出 topic 时清理」）。仓库保持 public、Release 正常，只是不再出现在市场列表里。

> 想被收录时：`gh repo edit IcinessLove/dsh-learning-mode --add-topic dsh-pack`，等采集器下一轮（≤6 小时）。
> 查收录状态：打开 `https://raw.githubusercontent.com/DSH-PackForge/dsh-pack-market/main/index/index.json` 搜 `dsh-learning-mode`——撤话题后应在下一轮消失。

| tag | Release | 资产（.dspack sha256） |
|---|---|---|
| `v0.1.1` | https://github.com/IcinessLove/dsh-learning-mode/releases/tag/v0.1.1 | `55d51c85…1178` |
| `v0.1.0` | https://github.com/IcinessLove/dsh-learning-mode/releases/tag/v0.1.0 | `76a47b38…6084` |

升版本见 [CHANGELOG.md](CHANGELOG.md)。以下步骤保留作**重新发布 / 升版本**时的参考。

## 0. 装并登录 GitHub CLI（一次性）

```powershell
winget install --id GitHub.cli -e
# 新开一个终端让 PATH 生效，然后：
gh auth login
gh auth status
```

## 1. 建仓库 + 推送（**不打话题**）

```powershell
cd <本目录>
gh repo create IcinessLove/dsh-learning-mode --public --source . --push
# 不要执行 gh repo edit ... --add-topic dsh-pack —— 那会把本包送进 dspack 市场
```

> 不用 `gh` 也可以：浏览器新建 **public** 空仓库 `dsh-learning-mode`（不要勾 README），然后
> `git push -u origin main`（会弹凭据）。仓库 About 里**不要**加 `dsh-pack` 话题。

## 2. 发正式 Release（两个资产，缺一不可）

以 v0.1.1 为例（升版本时把三处版本号一起改）：

```powershell
gh release create v0.1.1 `
  release/dsh-learning-mode-0.1.1.dspack `
  release/dsh-learning-mode-0.1.1.dspack.sha256 `
  --title "dsh-learning-mode v0.1.1" `
  --notes "修复：面板动作未携带主题导致上下文包错位（改用锚点归属解析 + 面板钉住当前主题）；标注 callout 去重按完整 header。"
```

> 不要加 `--draft` / `--prerelease`，否则 `releases/latest` 取不到，市场扫不到。

## 3. 逐项校验

```powershell
gh repo view IcinessLove/dsh-learning-mode --json visibility,repositoryTopics `
  --jq '{visibility, topics: [.repositoryTopics[].name]}'
# 期望：PUBLIC + topics 为空（不含 dsh-pack）

gh release view v0.1.1 --json tagName,isDraft,isPrerelease,assets `
  --jq '{tag: .tagName, draft: .isDraft, prerelease: .isPrerelease, assets: [.assets[].name]}'
# 期望：tag=v0.1.1、draft=false、prerelease=false、assets 恰好两个
```

## 4. 另一台设备怎么装

**本包不进市场**，从 GitHub 直接装（三选一）：

**方式一（.dspack，推荐给装了 PackForge 的设备）**：

```powershell
gh release download v0.1.1 --repo IcinessLove/dsh-learning-mode --pattern "*.dspack*" -D .
# 用 PackForge 设置面板「安装 .dspack」选择下载到的文件（本地文件安装，不经过市场）
```

**方式二（便携包，不依赖 PackForge）**：

```powershell
gh api repos/IcinessLove/dsh-learning-mode/contents/portable/learning-mode-0.1.1.zip --jq .content | ... 
# 更简单：浏览器打开仓库 → portable/learning-mode-0.1.1.zip → Download
Expand-Archive .\learning-mode-0.1.1.zip -DestinationPath .\lm
# 然后按 INSTALL.md：图形界面「添加插件 → 本地绝对路径」，或跑 install.ps1
```

**方式三（源码）**：

```powershell
git clone https://github.com/IcinessLove/dsh-learning-mode.git
cd dsh-learning-mode
pwsh -File .\install.ps1
```

装完都要**完全退出并重启** DeepSeek Desktop。

## 校验和（本地产物）

| 产物 | 大小 | sha256 |
|---|---|---|
| `release/dsh-learning-mode-0.1.1.dspack` | 242,688 B | `55d51c85b9e5380108807b02cbe235b76ac55953596c6de1556af431b77d1178` |
| `portable/learning-mode-0.1.1.zip` | — | — |
| `release/dsh-learning-mode-0.1.0.dspack`（历史） | 235,149 B | `76a47b385cdaadbb4ba7cf9bc3e18a3c4f97e76f5c4892903d0893df28806084` |

已做的校验：

- `manifest.json` 用 PackForge 自带的 `validateManifest` 校验通过（v5 / type=profile / bundles / dependencies 版本一致 / vendored 五字段）；
- 包内 `manifest.vendored["@local/learning-mode"]` 的 sha256 与 size 与包内实际 tarball 逐字节一致；
- 两个 ZIP 的**原始条目名均为正斜杠**（用 bsdtar 生成；`Compress-Archive` 会写成反斜杠，会导致跨平台解压出畸形文件名与安装器找不到 `vendor/` 下的 tarball）；
- `release/` 恰好两个资产（`.dspack` + `.sha256`），便携包放在 `portable/`，避免采集器选错包。

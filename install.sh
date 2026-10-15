#!/usr/bin/env bash
# 安装 learning-mode bundle 到当前用户的 DSH profile。
# 用法：./install.sh [profile]          默认 desktop
#       DSH_HOME=/path/to/.dsh ./install.sh web
set -euo pipefail

PROFILE="${1:-desktop}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_SRC="$ROOT/learning-mode"

[ -d "$PLUGIN_SRC" ] || { echo "找不到 learning-mode 目录（应与本脚本同级）：$PLUGIN_SRC" >&2; exit 1; }

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
[ -d "$PROFILE_DIR" ] || { echo "找不到 profile 目录：$PROFILE_DIR" >&2; exit 1; }

# profile 可能是符号链接（例如 desktop -> default）
PROFILE_DIR="$(cd "$PROFILE_DIR" && pwd -P)"
echo "profile 实际目录：$PROFILE_DIR"

SCOPE_DIR="$PROFILE_DIR/node_modules/@local"
DEST="$SCOPE_DIR/learning-mode"
mkdir -p "$SCOPE_DIR"
rm -rf "$DEST"
cp -R "$PLUGIN_SRC" "$DEST"
echo "已复制到：$DEST"

PKG="$PROFILE_DIR/package.json"
cp "$PKG" "$PKG.bak-learning-mode"

command -v python3 >/dev/null 2>&1 || {
  echo "需要 python3 来安全地修改 profile package.json。" >&2
  echo "请手动把 \"@local/learning-mode\" 加入 dependencies 与 dsh.profile.bundles，然后重启应用。" >&2
  exit 1
}

python3 - "$PKG" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding='utf-8') as fh:
    data = json.load(fh)
deps = data.setdefault('dependencies', {})
deps.setdefault('@local/learning-mode', 'file:./node_modules/@local/learning-mode')
profile = data.setdefault('dsh', {}).setdefault('profile', {})
bundles = profile.setdefault('bundles', [])
if '@local/learning-mode' not in bundles:
    bundles.append('@local/learning-mode')
with open(path, 'w', encoding='utf-8') as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write('\n')
print('已在 profile package.json 中登记（备份：package.json.bak-learning-mode）')
PY

echo
echo "安装完成。请【完全退出并重启】DeepSeek Desktop（含托盘），然后点侧边栏「学习模式」。"

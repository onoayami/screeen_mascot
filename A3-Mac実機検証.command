#!/bin/bash
set -u

SOURCE_ROOT="$(cd "$(dirname "$0")" && pwd)"
INSPECTOR="$SOURCE_ROOT/scripts/inspect-a3-extraction.mjs"

pause_and_exit() {
  code="$1"
  echo ""
  read -r -p "Enterキーで閉じます。" _unused
  exit "$code"
}

if [ "$(uname -s)" != "Darwin" ]; then
  echo "この検証はMac実機専用です。Macで実行してください。"
  pause_and_exit 1
fi
if [ -e "$SOURCE_ROOT/.git" ] || [ -e "$SOURCE_ROOT/node_modules" ] || [ -e "$SOURCE_ROOT/dist" ]; then
  echo "安全のため、開発中フォルダではなく、配布されたソースZIPをアーカイブユーティリティで展開した直後のフォルダで実行してください。"
  pause_and_exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.jsが見つかりません。Node.jsのLTS版を入れてから再実行してください。"
  open "https://nodejs.org/"
  pause_and_exit 1
fi

STAMP="$(date '+%Y%m%d-%H%M%S')"
DESKTOP="$HOME/Desktop"
RESULT_DIR="$DESKTOP/Desktop-Mascot-A3-Result-$STAMP"
RESULT_ZIP="$RESULT_DIR.zip"
BUILD_DIR="$DESKTOP/Desktop-Mascot-A3-Build-$STAMP"
WORK_ROOT="$(mktemp -d /tmp/desktop-mascot-a3.XXXXXX)" || pause_and_exit 1
WORK_SOURCE="$WORK_ROOT/source"
STATUS=0
VALIDATION_OK=1
FAILURES=()
mkdir -p "$RESULT_DIR" "$WORK_SOURCE"
trap 'rm -rf "$WORK_ROOT"' EXIT

record_failure() {
  STATUS=1
  VALIDATION_OK=0
  FAILURES+=("$1")
}

run_logged() {
  log_name="$1"
  shift
  log_path="$RESULT_DIR/$log_name"
  printf '実行:' > "$log_path"
  printf ' %q' "$@" >> "$log_path"
  printf '\n\n' >> "$log_path"
  "$@" >> "$log_path" 2>&1
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "失敗: $log_name（終了コード $code）"
    record_failure "$log_name"
    return "$code"
  fi
  echo "成功: $log_name"
  return 0
}

{
  echo "実行日時UTC: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "macOS:"
  /usr/bin/sw_vers
  echo "CPUアーキテクチャ: $(uname -m)"
  echo "Macモデル: $(/usr/sbin/sysctl -n hw.model 2>/dev/null || echo '取得できませんでした')"
  echo "Node: $(node --version)"
  echo "npm: $(npm --version)"
  echo "検証元: 配布ソースZIP展開フォルダ（絶対パスは記録しません）"
} > "$RESULT_DIR/mac-environment.txt"

if ! run_logged "01-source-before.log" node "$INSPECTOR" --root "$SOURCE_ROOT" --output "$RESULT_DIR/source-before.json"; then
  VALIDATION_OK=0
fi

if [ "$VALIDATION_OK" -eq 1 ]; then
  if ! run_logged "02-copy-to-temporary.log" /usr/bin/rsync -a --delete \
    --exclude '.git/' --exclude 'node_modules/' --exclude 'dist/' --exclude '.DS_Store' \
    "$SOURCE_ROOT/" "$WORK_SOURCE/"; then
    VALIDATION_OK=0
  fi
fi

if [ "$VALIDATION_OK" -eq 1 ]; then
  if ! cd "$WORK_SOURCE"; then
    echo "一時コピーへ移動できないため、以降の処理を中止します。"
    record_failure "一時コピーへ移動"
    pause_and_exit 1
  fi
  if run_logged "03-dependency-candidate.log" npm install --package-lock-only --ignore-scripts --save-dev --save-exact electron@latest electron-builder@latest; then
    cp package.json "$RESULT_DIR/candidate-package.json"
    cp package-lock.json "$RESULT_DIR/candidate-package-lock.json"
    run_logged "04-dependency-lock-check.log" node scripts/check-build-lock.js || true
    node - <<'NODE' > "$RESULT_DIR/dependency-candidate.json"
const packageJson = require('./package.json');
const lock = require('./package-lock.json');
const names = ['electron', 'electron-builder'];
const result = {
  node: process.version,
  dependencies: Object.fromEntries(names.map((name) => [name, {
    declared: packageJson.devDependencies?.[name] ?? null,
    resolved: lock.packages?.[`node_modules/${name}`]?.version ?? null,
  }])),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
NODE
  else
    VALIDATION_OK=0
  fi
fi

if [ "$VALIDATION_OK" -eq 1 ]; then
  run_logged "05-npm-ci.log" npm ci || VALIDATION_OK=0
fi
if [ "$VALIDATION_OK" -eq 1 ]; then
  run_logged "06-check.log" npm run check || true
  run_logged "07-release-a3.log" npm run test:release-a3 || true
  run_logged "08-release-a2.log" npm run test:release-a2 || true
  run_logged "09-release-a1.log" npm run test:release-a1 || true
  run_logged "10-phase0-harness.log" npm run test:phase0:harness || true
  run_logged "11-known-defects.log" npm run test:phase0:known-defects || true
fi

if [ "$VALIDATION_OK" -eq 1 ]; then
  run_logged "12-build-universal.log" env CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac:universal || true
else
  echo "前段の検証が失敗したためUniversalビルドは実行しませんでした。" > "$RESULT_DIR/12-build-universal.log"
fi

if [ -d "$WORK_SOURCE/dist" ]; then
  mkdir -p "$BUILD_DIR"
  /usr/bin/ditto "$WORK_SOURCE/dist" "$BUILD_DIR/dist"
  {
    echo "ビルド成果物SHA-256"
    find "$WORK_SOURCE/dist" -type f | LC_ALL=C sort | while IFS= read -r file; do
      relative="${file#$WORK_SOURCE/dist/}"
      digest="$(/usr/bin/shasum -a 256 "$file" | awk '{print $1}')"
      printf '%s  %s\n' "$digest" "$relative"
    done
  } > "$RESULT_DIR/build-artifact-sha256.txt"
  : > "$RESULT_DIR/dmg-verification.log"
  find "$WORK_SOURCE/dist" -type f -name '*.dmg' | LC_ALL=C sort | while IFS= read -r dmg; do
    echo "=== ${dmg#$WORK_SOURCE/dist/} ===" >> "$RESULT_DIR/dmg-verification.log"
    /usr/bin/hdiutil verify "$dmg" >> "$RESULT_DIR/dmg-verification.log" 2>&1 || true
  done
  : > "$RESULT_DIR/app-architectures.log"
  find "$WORK_SOURCE/dist" -path '*.app/Contents/MacOS/*' -type f | LC_ALL=C sort | while IFS= read -r binary; do
    echo "=== ${binary#$WORK_SOURCE/dist/} ===" >> "$RESULT_DIR/app-architectures.log"
    /usr/bin/file "$binary" >> "$RESULT_DIR/app-architectures.log" 2>&1 || true
    /usr/bin/lipo -archs "$binary" >> "$RESULT_DIR/app-architectures.log" 2>&1 || true
  done
fi

cd "$SOURCE_ROOT" || STATUS=1
if ! run_logged "13-source-after.log" node "$INSPECTOR" --root "$SOURCE_ROOT" --output "$RESULT_DIR/source-after.json"; then
  STATUS=1
fi
if ! node - "$RESULT_DIR/source-before.json" "$RESULT_DIR/source-after.json" <<'NODE' > "$RESULT_DIR/source-integrity.txt" 2>&1
const fs = require('fs');
const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const after = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
if (before.treeSha256 !== after.treeSha256 || before.fileCount !== after.fileCount) {
  console.error('原本のツリーハッシュが変化しました。');
  process.exit(1);
}
console.log(`原本不変OK: ${before.fileCount}ファイル`);
console.log(`treeSha256=${before.treeSha256}`);
NODE
then
  record_failure "原本不変検査"
fi

{
  if [ "$STATUS" -eq 0 ]; then
    echo "自動検証結果: 成功"
  else
    echo "自動検証結果: 失敗"
  fi
  echo ""
  echo "失敗項目: ${FAILURES[*]:-なし}"
  echo ""
  echo "未確認のため成功扱いにしない項目:"
  echo "- 実際のマスコット表示と操作"
  echo "- Intel Mac上での実起動（Intel機で別途実施）"
  echo "- 最低対応macOSでの実起動"
  echo "- Developer ID署名、公証、Gatekeeper"
  echo "- Windows標準展開（Windows用ランチャーで別途実施）"
  echo ""
  echo "candidate-package.jsonとcandidate-package-lock.jsonは候補です。原本へ自動反映していません。"
} > "$RESULT_DIR/結果を確認してください.txt"

node - "$RESULT_DIR" "$HOME" "$WORK_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, home, work] = process.argv.slice(2);
const textExtensions = new Set(['.json', '.log', '.md', '.txt']);
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filePath);
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) {
      let text = fs.readFileSync(filePath, 'utf8');
      text = text.split(home).join('~').split(work).join('<temporary-workspace>');
      text = text.replace(/https?:\/\/[^\s/:@]+:[^\s/@]+@/g, 'https://<credentials>@');
      fs.writeFileSync(filePath, text, 'utf8');
    }
  }
};
walk(root);
NODE

/usr/bin/ditto -c -k --keepParent "$RESULT_DIR" "$RESULT_ZIP"
open "$RESULT_DIR"
if [ -d "$BUILD_DIR" ]; then open "$BUILD_DIR"; fi

echo ""
echo "検証結果: $RESULT_ZIP"
if [ -d "$BUILD_DIR" ]; then echo "ビルド結果: $BUILD_DIR"; fi
if [ "$STATUS" -eq 0 ]; then
  echo "自動検証は成功しました。手動確認項目は未完了のままです。"
else
  echo "失敗があります。結果ZIPを共有してください。"
fi
pause_and_exit "$STATUS"

'use strict';

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const TEXT_EXTENSIONS = new Set([
  '.bat',
  '.command',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ps1',
  '.py',
  '.txt',
]);
const EXCLUDED_DIRECTORIES = new Set(['.git', 'dist', 'node_modules']);
const STALE_FOLDER_NAME = 'desktop-mascot-starter';

function portablePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function isEndUserDocument(relativePath) {
  return relativePath === 'README.md'
    || relativePath === 'START_HERE.txt'
    || relativePath.startsWith('docs/');
}

function collectTextFiles(root) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) return [];
  const files = [];
  const walk = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(filePath);
      }
    }
  };
  walk(resolvedRoot);
  return files;
}

function scanReleaseText(root) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) return [`配布検査対象が見つかりません：${resolvedRoot}`];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const errors = [];
  for (const filePath of collectTextFiles(resolvedRoot)) {
    const relativePath = portablePath(resolvedRoot, filePath);
    if (relativePath !== relativePath.normalize('NFC')) {
      errors.push(`${relativePath}: ファイル名をUnicode NFCへ統一してください。`);
    }
    let text;
    try {
      text = decoder.decode(fs.readFileSync(filePath));
    } catch (error) {
      errors.push(`${relativePath}: UTF-8として読めません（${error.message}）。`);
      continue;
    }
    if (text.includes('\uFFFD')) {
      errors.push(`${relativePath}: 置換文字U+FFFDが含まれています。原文を確認してください。`);
    }
    if (isEndUserDocument(relativePath) && text.includes(STALE_FOLDER_NAME)) {
      errors.push(`${relativePath}: 存在しない固定フォルダ名「${STALE_FOLDER_NAME}」が残っています。`);
    }
  }
  return errors;
}

function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const files = collectTextFiles(root);
  const errors = scanReleaseText(root);
  if (errors.length > 0) {
    console.error('\n配布テキストの検査で問題が見つかりました:\n');
    errors.forEach((error) => console.error(`- ${error}`));
    console.error('');
    process.exitCode = 1;
    return;
  }
  console.log(`配布テキストOK: ${files.length}ファイルをUTF-8・U+FFFD・NFCについて確認しました。`);
}

if (require.main === module) run();

module.exports = {
  collectTextFiles,
  scanReleaseText,
};

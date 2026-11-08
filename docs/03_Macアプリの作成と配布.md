# 03｜Macアプリの作成と配布

> **Release A3検証中**：未確認の`latest`依存では配布ビルドを作りません。先に`docs/06_A3実機検証.md`に沿ってMac実機検証を行い、確認済みの`package-lock.json`を反映してください。

## 全体の流れ

1. 名前・画像・バージョンを決める
2. 設定画面で画像と動きを登録する
3. **配布版へ反映** を押す
4. ローカルで起動して確認する
5. `.dmg` を作る
6. 少人数テスト、または署名・公証を行う
7. `.dmg` を配布する

## 1. アプリ情報を変更する

`package.json` の次の箇所を変更します。

```json
{
  "productName": "あなたのアプリ名",
  "version": "1.0.0",
  "author": "あなたの名前",
  "build": {
    "appId": "com.github.onoayami.desktopmascot",
    "productName": "あなたのアプリ名"
  }
}
```

- `productName`：FinderやDMGに表示する名前
- `version`：最初は `1.0.0`。更新時は `1.0.1` などへ変更
- `author`：制作者名
- `appId`：世界で重ならない識別子。例 `jp.example.myjellyfish`

`productName` は上部と `build` 内の2か所を同じ名前にしてください。

アプリアイコンは `build/icon.png` を1024×1024pxのPNGへ差し替えます。

## 2. 設定を配布版へ反映

開発中のアプリを起動し、🪼 → **設定を開く…** から画像と動きを完成させます。**保存して反映** の後に **配布版へ反映** を押してください。これで現在の設定が `characters/default` へコピーされます。

## 3. 最終確認

確認済みの`package-lock.json`を反映した後に実行します。未反映の場合は、先に`A3-Mac実機検証.command`をダブルクリックしてください。

```bash
npm ci
npm run check
npm start
```

確認すること：

- 画像が欠けていない
- 全動作が一度は表示される
- エフェクトが必要な動作だけに出る
- キャラクター以外の場所をクリックできる
- 🪼メニューから停止・再開・終了できる

## 4. 配布ファイルを作る

### Apple Siliconのみ

M1・M2・M3・M4などのMac向けです。

```bash
npm run build:mac:arm64
```

### Intel Macのみ

```bash
npm run build:mac:x64
```

### 両方へ1本で配る

ファイルは大きくなりますが、初心者にはこれが分かりやすいです。

```bash
npm run build:mac:universal
```

完了後、`dist` フォルダに次のようなファイルができます。

```text
Desktop Mascot-1.0.0-universal.dmg
Desktop Mascot-1.0.0-universal.zip
```

通常は **`.dmg` を利用者へ配布**します。ソースコードのZIPではありません。
ソースZIPの作成にはPython 3の`python3`コマンドが必要です。

## 5. 配布方法は2段階あります

### A. 少人数のテスト配布

Appleの署名なしでもビルド自体はできますが、受け取った人のMacで「開発元を確認できない」などの警告が出ます。OSのバージョンによっては、システム設定の **プライバシーとセキュリティ → このまま開く** が必要です。

これは身内テスト向けです。一般公開では、利用者へ警告解除を求めないよう、次の署名・公証を行うことを推奨します。

### B. 一般公開する配布

Mac App Store外で自然に起動してもらうには、原則として次が必要です。

1. Apple Developer Programへ参加
2. **Developer ID Application** 証明書をMacのキーチェーンへ入れる
3. Hardened Runtimeを有効にして署名
4. Appleの公証（Notarization）を通す
5. 公証チケットをアプリまたはDMGへ付与する

このスターターはHardened Runtimeを有効にしています。有効なDeveloper ID証明書がキーチェーンにあると、electron-builderがビルド時に自動検出して署名します。

公証には、electron-builderが案内する次のいずれかの認証方法を使います。

- App Store Connect APIキー（CIや継続配布向け）
- Apple ID・アプリ用パスワード・Team ID
- `notarytool` のキーチェーンプロファイル

秘密情報は `package.json`、コード、GitHubへ絶対に書かないでください。認証設定後に、同じビルドコマンドを実行します。

```bash
npm run build:mac:universal
```

公式資料：

- Apple「Distributing software on macOS」：<https://developer.apple.com/macos/distribution/>
- Apple「Developer ID」：<https://developer.apple.com/developer-id/>
- electron-builder「macOS Notarization」：<https://www.electron.build/docs/features/code-signing/notarization/>
- electron-builder「Code Signing for macOS」：<https://www.electron.build/docs/features/code-signing/code-signing-mac/>

## 6. 署名・公証の確認

ビルド後、実際のファイル名に置き換えて確認します。

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-universal/あなたのアプリ名.app"
```

```bash
spctl --assess --type execute --verbose "dist/mac-universal/あなたのアプリ名.app"
```

公証済みDMGの確認：

```bash
xcrun stapler validate "dist/あなたのアプリ名-1.0.0-universal.dmg"
```

## 7. 実際に配る

配布先の例：

- Google Drive・Dropbox：少人数テスト
- GitHub Releases：バージョン管理しながら無料配布
- 自分のWebサイト：一般公開

配布物：

- `.dmg`
- `docs/04_利用者向け説明書.md` をPDFやWebページにしたもの
- バージョン番号と更新内容
- 問い合わせ先

可能ならSHA-256も掲載します。

```bash
shasum -a 256 "dist/あなたのアプリ名-1.0.0-universal.dmg"
```

## 8. 更新版を配る

1. `package.json` の `version` を上げる
2. 更新内容をメモする
3. 再ビルドする
4. 新しいDMGとSHA-256を公開する
5. 利用者には古いアプリを新しいアプリで置き換えてもらう

このスターターには自動更新機能は入っていません。最初は手動更新の方が安全で簡単です。

## 9. 権利と表示

- 配布可能な画像・GIF・フォントだけを使用してください。
- 他者のキャラクターや作品は、二次配布可能か必ず確認してください。
- 必要に応じて利用規約、プライバシーポリシー、素材クレジットを同梱してください。
- このテンプレート自体はMIT Licenseですが、差し替えた素材の権利は別です。

## Mac App Storeについて

Mac App Store配布は、Developer IDの直接配布とは証明書・Sandbox・審査手順が異なります。このスターターはまず **App Store外のDMG配布** を対象にしています。

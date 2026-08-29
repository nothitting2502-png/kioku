# GitHub運用

提案書 5.2 / 9章「GitHubへ個人データを誤登録するリスク」への対策を、この運用ルールで担保します。

## 原則

**GitHubに置くのは開発ファイルだけ。利用データ（音声・文字起こし・メモ）は端末内に留める。**

このアプリはサーバーを持たず、記録はすべてブラウザの IndexedDB に入ります。
そのため、通常の操作でリポジトリに個人データが入ることはありません。
入るとすれば「書き出したファイルをうっかりコミットする」場合だけなので、そこを二重に塞いでいます。

1. `.gitignore` … `*.webm` `*.m4a` `*.wav` `*-backup.json` `.env` `*.keystore` などを除外
2. CI … コミットされたファイル一覧を検査し、音声・秘密情報らしきものがあれば**ビルドを失敗させる**

## 現在の構成

| 項目 | 値 |
| --- | --- |
| リポジトリ | https://github.com/nothitting2502-png/kioku （Public） |
| 公開URL | https://nothitting2502-png.github.io/kioku/ |
| Pages のソース | `main` ブランチのルート（`main` に push すれば自動で反映） |

**Publicにしている理由**: GitHub Pages を無料プランで使うため。
このアプリはサーバーを持たず、記録はすべて端末のブラウザ内（IndexedDB）にあるため、
ソースが公開されても記録が他人に見えることはありません。

非公開にしたい場合は、Privateへ切り替えたうえで GitHub Pro に加入するか、
Cloudflare Pages / Netlify / Vercel の無料枠へデプロイしてください。

```bash
gh repo edit nothitting2502-png/kioku --visibility private
```

（任意）`main` への直接pushを禁止し、PR必須にする Branch protection も設定できます。

## ブランチ運用

| ブランチ | 用途 |
| --- | --- |
| `main` | 動作確認済みの安定版。ここに入ったものが自動で公開される |
| `feature/*` | 機能追加・修正。PRでmainへ入れる |

```bash
git switch -c feature/note-templates
# ...作業...
git push -u origin feature/note-templates
gh pr create --fill
```

## ワークフロー

| ファイル | 実行タイミング | 内容 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR | ユニットテスト、全JSの構文チェック、個人データ・秘密情報の混入検査、PWA必須ファイルの存在確認 |

デプロイ用のワークフローは置いていません。Pages が `main` のルートを直接配信するため、
push だけで公開が更新されます。

### CIを有効にする

GitHub CLI のトークンに `workflow` スコープが無いと、`.github/workflows/` 配下は push できません。
一度だけ次を実行してから push してください。

```bash
gh auth refresh -h github.com -s workflow
git add .github && git commit -m "CI ワークフローを追加" && git push
```

## 秘密情報

現状このアプリはAPIキーを使いません（ブラウザ内蔵の音声認識のみ）。
将来、外部の文字起こしAPIへ切り替える場合は、次のとおりにします。

- キーをコードやリポジトリに書かない
- ブラウザから直接APIを叩かない（キーが利用者に見えるため）。中継用の関数（Cloudflare Workers など）を挟む
- キーは GitHub Secrets、またはホスティング側の環境変数に置く

## リリース

動作確認できた版にタグを打ちます。

```bash
git tag -a v0.1.0 -m "個人用MVP"
git push origin v0.1.0
gh release create v0.1.0 --notes "録音・文字起こし・複数メモ・検索・書き出し"
```

ネイティブAndroidアプリへ移行した際は、提案書のとおりAPKを Releases に添付します。

## What

世界の量子ニュースを調査し、自然な日本語の記事と画像を保存・公開する Leona Quantum News を追加します。画面は `apps/news`、保存と認証は既存API、収集・生成・定期実行は既存Workerを使用します。途中再開、出典検証、編集、公開・取り下げに対応しています。

**運用担当者への依頼：このPRのmergeだけでは `news.leonaquantum.com` は公開されません。以下の初回設定を実施し、公開確認までお願いします。** 初期状態では収集・公開・自動投稿を無効にしています。

## Why

オーナーから依頼されたニュースメディアの本番接続を、既存の認証・ジョブキュー・DB移行・CI/CDに統合します。初回設定後、コードの更新は通常のPR→`dev`へのmerge、記事の更新はWorkerの定期実行で行います。

## 運用担当者への作業依頼（初回のみ）

@EshMis に、マイグレーション・デプロイ変更のレビューと、以下の初期設定の実施または担当者の割り当てをお願いします。別の方が担当する場合は、このPRに担当者を記載してください。

詳細手順： [apps/news/RUNBOOK.md](https://github.com/Leona-Quantum/leona/blob/feature/leona-news-integration/apps/news/RUNBOOK.md)。以下のチェック欄は、実際の作業完了後に更新してください。

### 1. Vercel：ニュース用プロジェクト

- [ ] 既存チームに `leona-news` プロジェクトを作成し、同じ `Leona-Quantum/leona` リポジトリへ接続する。
- [ ] Root Directory=`apps/news`、Framework=Other、Node.js=24.x、Production Branch=`dev` を設定する。
- [ ] Build Command=`node build-vercel.mjs`。Install Commandは `apps/news/vercel.json` の設定を使い、Output Directoryの手動上書きは無効にする。
- [ ] VercelのProduction環境に `LEONA_NEWS_API_URL=<既存の本番APIのHTTPS origin>`、`SITE_URL=https://news.leonaquantum.com` を登録する。API URLに `/v1/news` は付けない。
- [ ] デプロイ成功を確認する。Preview環境は保護を有効にし、必要に応じて公開済みデータだけを返すAPIを接続する。

OpenAIキー・DB接続情報・編集者の認証トークンはVercelに登録しません。既存Leona本体のVercelプロジェクトはそのまま使用します。

### 2. Google Cloud / GitHub：API・Worker

対象：GCP `majorana-core` / `us-west1`、既存サービス `majorana-api` / `majorana-worker`。

- [ ] ニュースを管理する既存workspaceの内部UUIDと、そこでowner/admin権限を持つ編集者の内部ユーザーUUIDを確認する。
- [ ] OpenAIキーをGoogle Secret Managerに登録する、または利用可能な既存シークレットを確認する。Workerの実行用サービスアカウントに、対象シークレットのSecret Manager Secret Accessor権限を付与する。
- [ ] GitHub → Settings → Secrets and variables → Actions → **Variables** に `LEONA_NEWS_OPENAI_SECRET_VERSION` を登録する。値は `シークレット名:数値バージョン`（例：`LEONA_NEWS_OPENAI_API_KEY:1`）。APIキー本体や `:latest` は入力しない。
- [ ] `infra/news.json` にworkspace/editorのUUIDを記入し、`enabled=true` にする。最初は `public=false`、`schedule_enabled=false`、`auto_publish=false` を保つ。変更をレビューのうえPRで反映する。
- [ ] リリース承認後、`dev`へのmergeで既存deploy workflowを実行し、DB移行とAPI・Workerの更新成功を確認する。設定はworkflowが反映するため、同じマイグレーションを手動で重複実行する必要はない。
- [ ] 小規模な有料テストでモデル利用可否と記事・画像の品質を確認し、ローカル編集画面から最初の記事を公開する。編集画面の起動・管理者認証はRUNBOOKの「Make and review the first draft」を参照。
- [ ] `infra/news.json` の `public=true` をPRで反映し、Vercel発行URLで記事と画像が表示され、`/readyz` がHTTP 200と `{"ready":true}` を返すことを確認する。
- [ ] 自動運用を開始するときは、品質と利用上限の確認後、`schedule_enabled=true`、`auto_publish=true` をPRで反映する。設定済みの初期値は8時間間隔・1日3バッチ上限。

ローカルの `.env` はアップロードも自動同期もされません。キーはSecret ManagerからWorkerの `OPENAI_API_KEY` へ接続されます。既存Workerがすでに同名変数を利用している場合は、既存処理のモデル権限・利用枠も維持できるキーか確認してください。ニュース設定をCloud Run画面で一時変更した場合も、次回deployまでに `infra/news.json` へ反映してください。

### 3. Cloudflare：独自ドメイン

- [ ] 上記の表示確認後、ニュース用Vercelプロジェクトの Settings → Domains に `news.leonaquantum.com` を追加する。
- [ ] Cloudflare → `leonaquantum.com` → DNS → Records で、Type=`CNAME`、Name=`news`、Target=**Vercelが表示した正確な接続先**、Proxy=`DNS only`（灰色の雲）、TTL=`Auto` を設定する。
- [ ] Vercelが所有権確認用TXTを要求した場合は、その名前と値も登録する。既存の `news` レコードがあれば用途を確認してから更新する。
- [ ] Vercelのドメイン設定が有効になり、HTTPS証明書の発行が完了したことを確認する。

接続先CNAMEはプロジェクト作成後に確定します。既存のapex・www・メール用DNSレコードとネームサーバーは変更しません。

### 作業完了の条件・報告

- [ ] `https://news.leonaquantum.com` で公開記事一覧・記事本文・画像・出典リンクが正常に表示される。
- [ ] `/readyz` がHTTP 200、`/feed.xml` と `/sitemap.xml` が正常に返る。
- [ ] 既存Leona本体と既存Workerの処理に問題がない。
- [ ] バックアップ・障害監視・API利用量の確認先を担当者が確認する。
- [ ] このPRに、VercelプロジェクトURL、デプロイ結果、独自ドメイン確認結果、自動運用の有効/無効、残っている作業を記載する。キーや認証トークンは記載しない。

## Checks

- [ ] Full required GitHub CI green（PR作成後に確認）
- [x] Python 126件：実PostgreSQLの保存・RLS・並行処理と、既存Worker回復・認証関連の回帰テスト
- [x] Node 5件：生成したVercel配布物のHTTP動作も検証
- [x] 対象ファイルのRuff、Node構文/build、workspace inventory、workflow YAML/shell構文確認
- [x] ローカルPostgreSQLでmigration up→down→up。既存の最新 `dev` を土台に適用確認済み
- [x] `.env` を除外し、配布物は明示的なファイル一覧から作成。生成済みcontractの手編集なし
- [ ] migration / workflowのオーナーレビュー
- [ ] 実際の有料API生成・本番デプロイ・TLS/DNS・運用確認（上記の担当者作業）

UI確認画像は決定的なテストデータによるものです。実ニュースの生成結果ではありません。

| Desktop | Mobile |
|---|---|
| ![Desktop](https://github.com/Leona-Quantum/leona/blob/feature/leona-news-integration/apps/news/screenshots/live-article-desktop.png?raw=true) | ![Mobile](https://github.com/Leona-Quantum/leona/blob/feature/leona-news-integration/apps/news/screenshots/live-article-mobile.png?raw=true) |

[編集画面](https://github.com/Leona-Quantum/leona/blob/feature/leona-news-integration/apps/news/screenshots/editor-review.png)

`dev` は本番です。このPRのpush/作成は依頼済みですが、merge・本番設定変更はオーナーのリリース承認に従ってください。VercelとAPI/Workerは独立して更新されるため、前の画面からのAPI互換性を維持します。コードを戻す際にニュース用テーブルを削除する必要はありません。migrationのdowngradeはニュースデータを削除するため、バックアップとレビューが必要です。

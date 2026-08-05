> **ARCHIVED 2026-08-04.** the findings were applied — every string spot-checked from sections A, I and J is gone from the code. Its 用語集 glossary was promoted to `docs/ui/copy.md`, and four residues remain open (see that section).
> Retained for history; do not treat as current.

# 日本語UI文言監査

監査日: 2026-07-30
対象: `apps/web`、`packages/ts/ui` にある日本語UI・公開コンテンツ
参照: `/Users/rei/Downloads/AIC (3).pdf`（9ページ）、`/Users/rei/Downloads/leonaquantum.pdf`（29ページ）

## 結論

現在の日本語は意味自体はおおむね理解できますが、英語原文を一語ずつ対応させた直訳、抽象名詞の連続、利用者に不要な内部実装語が多く、全体としてかなりAI翻訳らしく見えます。

特に次の語が反復し、AI生成感を強めています。

| 現在の語 | 問題 | 基本の置き換え |
|---|---|---|
| 根拠 | `evidence` の一律直訳。日本語では何の根拠か分かりにくい | 検証結果、検証記録、裏付け、出典 |
| 境界 | `boundary` の一律直訳 | 検証範囲、制約、対象範囲、違い |
| レーン | `lane` の一律音写 | 実行環境、実行方法、処理系 |
| レコード | `record` の一律音写 | 項目、エントリ、記録 |
| アーティファクト | 技術者以外には意味が伝わりにくい | 保存済み回路、成果物。製品内の正式名称なら初出で説明 |
| コントロールプレーン／デプロイメント | 利用者に不要なインフラ用語 | サーバー、現在の環境、システム |
| 未スター | 日本語として成立していない | スターなし、スターは引き継がれません |
| パス | `path` の直訳 | 方法、実行方法、対応方式 |

参照PDFの日本語は、「量子回路生成AI」「シミュレーションを実行」「複数のフレームワークとの連携」のように、機能名と動作を短く具体的に書いています。UIもこの方向へ寄せると、製品の意図が伝わりやすくなります。

## A. 公開トップ・共通ナビゲーション

### 優先度A: 強いAI生成感、または意味が不明瞭

- 「量子研究に、検証できる根拠を。」→「量子研究を、検証可能に。」
  `apps/web/lib/public-copy.ts:122`
- 「公開研究」→ 文脈に応じて「公開された研究成果」「公開データベース」。日本語では研究行為そのものが公開されているように読めます。
  `apps/web/lib/public-copy.ts:123,134,151`
- 「過程まで見える実行」→「実行過程と検証結果を確認できる環境」
  `apps/web/lib/public-copy.ts:123`
- 「根拠を優先」→「検証を重視」
  `apps/web/lib/public-copy.ts:132`
- 「作成、編集、記録の保持」→「作成・編集・履歴保存」
  `apps/web/lib/public-copy.ts:135`
- 「文脈とともに進める量子開発」→「実行条件と検証履歴が残る量子開発」
  `apps/web/lib/public-copy.ts:139`
- 「量子研究には、根拠を置いておける場所が必要です。」→「量子研究には、コード・実行条件・検証結果をまとめて残せる場所が必要です。」
  `apps/web/lib/public-copy.ts:144`
- 「数値の前提は一緒に伝わりません。」→「数値だけでは、その前提条件まで伝わりません。」
  `apps/web/lib/public-copy.ts:145`
- 「三つの構成、ひとつの基準。」→「3つの機能を、1つの検証基準で。」
  `apps/web/lib/public-copy.ts:149`
- 「検証の境界」→「どこまで検証済みか」
  `apps/web/lib/public-copy.ts:151`
- 「自然言語の問いを、計画、実装、シミュレーション、検証、保存できるボールトの記録へ変えます。」→「自然言語で質問すると、計画、実装、シミュレーション、検証まで進み、結果をボールトに保存できます。」
  `apps/web/lib/public-copy.ts:152`
- 「根拠の境界が明確になった計算レーン」→「検証範囲と費用が明確な実行環境」
  `apps/web/lib/public-copy.ts:153`
- 「譲らないこと。」→「開発で重視すること」
  `apps/web/lib/public-copy.ts:158`
- 「根拠を先に」→「検証結果を明示」
  `apps/web/lib/public-copy.ts:160`
- 「まず開く」→「研究成果を公開」
  `apps/web/lib/public-copy.ts:161`
- 「プライバシーを設計に」→「非公開データを保護」
  `apps/web/lib/public-copy.ts:162`
- 「記録がツールより長く残るように。」→「ツールが変わっても記録を再利用できます。」
  `apps/web/lib/public-copy.ts:163`
- 「ノイズから、彼女が現れる。」→ ブランド説明として具体性がなく、最も生成AI的です。「ノイズの中から現れる雌ライオン。」など、図柄の説明に置き換えるべきです。
  `apps/web/lib/public-copy.ts:167`
- 「すべての結果は、断定ではなく分布に帰着します。」→「量子計算の結果は、測定値の分布として確認します。」
  `apps/web/lib/public-copy.ts:172`
- 「状態にバイアスをかけて測定すると」→「状態を変えながら測定を繰り返すと」。「バイアスをかける」はこの説明では不自然です。
  `apps/web/lib/public-copy.ts:172`
- 「私たちが実行に求めるのと同じ誠実さです。」→ 情緒的で意味が薄いため削除、または「実行結果も同じ基準で検証します。」
  `apps/web/lib/public-copy.ts:172`
- 「いま取り組んでいることを、聞かせてください。」→「取り組んでいる研究や課題をお聞かせください。」
  `apps/web/lib/public-copy.ts:176`

### 優先度B: 硬い、または統一感がない

- フッターの「探索」→「見る」または「サービス」。単独の名詞として不自然です。
  `apps/web/lib/public-locale.ts:42`
- ナビゲーションの「連絡先」→ 他画面と合わせて「お問い合わせ」
  `apps/web/lib/public-locale.ts:39`
- 「検証済みアーティファクトを通じて、信頼できる量子研究を支えます。」→「検証結果付きの回路と実行記録で、再現可能な量子研究を支えます。」
  `apps/web/lib/public-locale.ts:41`
- 「根拠を必要とする研究者、エンジニア、チームのために。」→「結果を検証・再現したい研究者、エンジニア、チームのために。」
  `apps/web/lib/public-locale.ts:48`
- 「Leona 実行」→ 製品名なら「Leona Run」、一般機能名なら「実行」に統一
  `apps/web/lib/workspace-locale.ts:681`
- `Studio`／`スタジオ`、`Vault`／`ボールト`、`Run`／`実行` が画面ごとに揺れています。正式名称を一つ決めて統一する必要があります。
  `apps/web/lib/workspace-locale.ts:685-687`、`packages/ts/ui/src/nav-config.ts:10-13`

## B. 料金・お問い合わせ

### 料金

- 「最初の実行からチームの研究まで、明確な道筋を。」→「個人の試用からチーム研究まで。」
  `apps/web/lib/public-copy.ts:198`
- 「検証量」→ 日本語として不自然です。「検証回数」または「検証できる実行数」
  `apps/web/lib/public-copy.ts:198`
- 「公開された根拠を見て」→「公開回路と検証結果を確認し」
  `apps/web/lib/public-copy.ts:201`
- 「試すのに十分な範囲です」→「実際の課題でワークベンチを試せます」
  `apps/web/lib/public-copy.ts:201`
- 「非公開研究、モデルの選択肢、エクスポートを意識したワークフローを広げます。」→「非公開の研究容量、利用できるモデル、エクスポート機能を拡張します。」
  `apps/web/lib/public-copy.ts:202`
- 「版管理」→ 一般的な「バージョン管理」
  `apps/web/lib/public-copy.ts:202`
- 「ベースラインとエクスポート表」→「古典手法との比較と、形式別エクスポート」
  `apps/web/lib/public-copy.ts:202`
- 「非公開コーパスの境界」→「非公開データの分離」
  `apps/web/lib/public-copy.ts:203`
- 「デザインパートナー対話」→「共同開発・導入相談」
  `apps/web/lib/public-copy.ts:203`
- 「透明なスタート」→「早期アクセスについて」
  `apps/web/lib/public-copy.ts:205`
- 「プロダクトは稼働中。決済はまだです。」→「サービスは利用できますが、有料決済はまだ開始していません。」
  `apps/web/lib/public-copy.ts:205`
- 「想定パッケージ」→「提供予定のプラン内容」
  `apps/web/lib/public-copy.ts:205`
- 「上限、クレジット、決済は有効化前に確定します。」→「利用上限、クレジット、決済条件は、有料提供の開始前に確定します。」
  `apps/web/lib/public-copy.ts:205`

### お問い合わせ

- 「量子ソフトウェアの根拠の層」→ `evidence layer` の直訳です。「量子ソフトウェアの実行・検証基盤」
  `apps/web/lib/public-copy.ts:234`
- 「企業R&Dと非公開コーパス」→「企業の研究開発と非公開データの利用」
  `apps/web/lib/public-copy.ts:236`
- 「送信すると、メールアプリで内容を準備したメールが開きます。」→「送信ボタンを押すと、入力内容を反映したメール作成画面が開きます。」
  `apps/web/lib/public-copy.ts:237`
- 「現在はmailto方式」→ 利用者向け文言では内部仕様が露出しすぎています。「現在、お問い合わせはメールで受け付けています。」
  `apps/web/lib/public-copy.ts:237`
- 「サーバー配信とCRM連携は運用が固まり次第対応します。」→ 利用者に不要なので削除
  `apps/web/lib/public-copy.ts:237`
- 「どんな根拠やアクセスが必要ですか？」→「どのような検証機能や利用環境が必要ですか？」
  `apps/web/lib/public-copy.ts:239`
- 「問い合わせを準備」→「メールを作成」
  `apps/web/lib/public-copy.ts:239`
- 「送信するとキューに追加されます。」→ 実際はメール送信なので「内容を確認してメールを送信してください。」
  `apps/web/lib/public-copy.ts:239`

## C. ワークスペース紹介ページ

- 「量子の問いを、あとから開ける研究へ。」→「量子の問いを、再現できる研究記録へ。」
  `apps/web/lib/public-copy.ts:289`
- 「保護されたシミュレータ」→「安全な実行環境」
  `apps/web/lib/public-copy.ts:290`
- 「検証の根拠」→「検証結果」
  `apps/web/lib/public-copy.ts:290`
- 「保存アーティファクト」→「保存した回路と実行記録」
  `apps/web/lib/public-copy.ts:290`
- 「ワークスペースを相談する」→「利用について相談する」
  `apps/web/lib/public-copy.ts:291`
- 「問いを計画、実装、シミュレーション、検証、読みやすい回答へつなげます。」→「質問から計画、実装、シミュレーション、検証、回答作成まで進めます。」
  `apps/web/lib/public-copy.ts:297`
- 「同じ根拠の流れで次の版を試せます。」→「同じ検証手順で次のバージョンを試せます。」
  `apps/web/lib/public-copy.ts:298`
- 「準備ができた計算レーンを選ぶ。」→「用途に合った実行環境を選ぶ。」
  `apps/web/lib/public-copy.ts:302`
- 「現在の対応パス」→「現在利用できる実行方法」
  `apps/web/lib/public-copy.ts:304`
- 「計算レーン」→「実行環境」
  `apps/web/lib/public-copy.ts:305`
- 「アテステーション」→ 一般利用者には通じません。「実行証明」または、機能が未定なら削除
  `apps/web/lib/public-copy.ts:306`
- 「ハードウェアレーン」→「量子ハードウェア実行」
  `apps/web/lib/public-copy.ts:306`
- 「開かれた基盤」→「公開情報」または「オープンな技術基盤」
  `apps/web/lib/public-copy.ts:309`
- 「エンジニアリングの境界を読む。」→「公開範囲と非公開範囲を確認する。」
  `apps/web/lib/public-copy.ts:310`
- 「公開研究は確認できる形で開き」→ 文法的に不自然です。「公開データベースは誰でも確認でき、認証済みワークスペース内の情報はアカウント単位で保護されます。」
  `apps/web/lib/public-copy.ts:311`

## D. 実行画面・チャット

- 「Groverでマーク状態を探す」→「Groverでマークされた状態を探す」
  `apps/web/lib/workspace-locale.ts:759`
- 「5ノードのリングにQAOAを使い」→「5ノードのリンググラフのMaxCut問題をQAOAで解き」
  `apps/web/lib/workspace-locale.ts:760`
- 「最良カット」→「最良の分割」
  `apps/web/lib/workspace-locale.ts:765`
- 「二次加速」→「二次の高速化」または「二乗の高速化」
  `apps/web/lib/workspace-locale.ts:766`
- 「2量子ビットのVQE ansatz」→「2量子ビットのVQEアンサッツ」
  `apps/web/lib/workspace-locale.ts:768`
- 「裾リスクをどうサンプルするか」→「テールリスクをどう推定するか」
  `apps/web/lib/workspace-locale.ts:771`
- 「対応するテキスト添付ではありません」→「対応していないファイル形式です」
  `apps/web/lib/workspace-locale.ts:788`
- 「検証済みコンテキストを保持」→「検証済みの回路を参照中」
  `apps/web/lib/workspace-locale.ts:793`
- 「アーティファクトのコンテキストを取得できません」→「保存済み回路を読み込めません」
  `apps/web/lib/workspace-locale.ts:794`
- モード名「アイデア」→ 動作を示す「アイデアを出す」または「検討」
  `apps/web/components/run-composer.tsx:68`
- 「量子アルゴリズムについて何でも聞いてください…」→「作りたい量子回路や、調べたいアルゴリズムを入力してください…」の方が製品機能を具体的に示します。
  `apps/web/components/run-composer.tsx:130`
- 「このプレビューではフィクスチャを使い、WorkOSとライブ制御プレーンを設定する間もプロダクトの流れを確認できます。」→ 内部実装が露出しています。「このプレビューではサンプルデータを使って、主な操作の流れを確認できます。」
  `apps/web/app/demo/demo-workspace.tsx:24`

## E. ボールト・保存済み回路

- 「保存した回路、バージョン、そして根拠。」→「保存した回路、バージョン、検証結果を管理します。」
  `apps/web/lib/workspace-locale.ts:796`
- 「検証不能」→「検証結果なし」または「検証できませんでした」
  `apps/web/lib/workspace-locale.ts:806`
- 「旧データ・根拠不明」→「旧形式・検証記録なし」
  `apps/web/lib/workspace-locale.ts:807`
- 「検証期限切れ」→ 実際に期限があるように読めます。`stale` が編集後の状態なら「変更後・要再検証」
  `apps/web/lib/workspace-locale.ts:808`
- 「新しい検証実行」→「新しく実行して検証」
  `apps/web/lib/workspace-locale.ts:814`
- 「実行で質問」→ 正式名に合わせて「Runで質問」または「この回路について質問」
  `apps/web/lib/workspace-locale.ts:816`
- 「リファレンスアーティファクト」→「参考用の保存済み回路」
  `apps/web/lib/workspace-locale.ts:824`
- 削除警告「ワークスペースから削除され、保存されません。」→ すでに保存済みの項目に対して論理が矛盾しています。「完全に削除され、元に戻せません。」
  `apps/web/lib/workspace-locale.ts:729-730,817`、`apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「アーティファクトの設定」→ メニューなら「その他の操作」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「Leona実行」→「Leona Run」または「実行」に統一
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「キュレーション例」→「運営が選んだサンプル」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「検証サマリー」→「検証結果の概要」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「実行プロベナンス」→「実行履歴」または「実行の来歴」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「frameworkのみ」→「元のフレームワークのみ」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「ロスレス」→「情報を失わずに変換可能」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「ネイティブOpenQASMエクスポート」→「OpenQASM形式のエクスポート」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「公開リファレンス」「リファレンス実行」→「公開サンプル」「参考実行」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「新しいワークスペースの根拠とする前に」→「このワークスペースの検証結果として使う前に」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「監査表示」→ 何が表示されるか不明です。「検証記録」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「ワークスペース固有の根拠を作るには」→「このワークスペースで検証結果を作成するには」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「キュレーションされた再生可能な例」→「運営が用意した、再実行できるサンプル」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「ライブワークスペースの実行」→「実際のワークスペースでの実行」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 「測定カウント」→「測定結果の件数」または単に「測定結果」
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:31`
- 日本語表示でも状態ラベルが `Failed`、`Executed`、`Verification unavailable`、`Verification stale`、`Legacy evidence unknown` のままです。これは不自然さではなく明確な未翻訳です。
  `apps/web/app/(app)/library/[artifactId]/artifact-detail.tsx:55-69`

## F. Studio・シミュレーション

### シミュレーション

- 「下書きの変更は検証されるまでローカルです」→「検証して保存するまで、変更はこの下書きにのみ反映されます。」
  `apps/web/lib/workspace-locale.ts:829`
- 「アーティファクトに紐づくシミュレーション記録」→「この保存済み回路のシミュレーション記録」
  `apps/web/lib/workspace-locale.ts:848,858`
- 「ブラウザ内のレーン」→「ブラウザ内シミュレーション」
  `apps/web/lib/workspace-locale.ts:850`
- 「結果を捏造せず、ここでは実行しません。」→ 防御的でAI回答のように見えます。「この回路はブラウザ内では実行できません。」
  `apps/web/lib/workspace-locale.ts:850`
- 「限定CPUシミュレーションレーン」→「ブラウザ内CPUシミュレーション」
  `apps/web/lib/workspace-locale.ts:851`
- 「代わりに実際に実行できます。」→「代わりにサンドボックスで実行できます。」
  `apps/web/lib/workspace-locale.ts:856`
- 「このコードを実際に実行」→「サンドボックスで実行」
  `apps/web/lib/workspace-locale.ts:857`
- 「このブラウザにローカルのシミュレーション記録を保存できないため」→「ブラウザにシミュレーション履歴を保存できなかったため」
  `apps/web/lib/workspace-locale.ts:861`
- 「Nala実行の開始やアーティファクトの検証は行っていません。」→ 内部名称を避け、「この結果は正式な検証結果ではありません。」
  `apps/web/lib/workspace-locale.ts:862`
- 「解析済みの限定ゲートモデルから、このブラウザで状態ベクトルを実行します。」→「対応するゲートだけを使い、ブラウザ上で状態ベクトルシミュレーションを行います。」
  `apps/web/lib/workspace-locale.ts:864`
- 「正確な下書きフィンガープリント」→「実行したコードの識別情報」
  `apps/web/lib/workspace-locale.ts:864`
- 「ローカル記録は検証、Nala実行、ハードウェア実行ではありません。」→「この履歴はローカルシミュレーションの結果であり、正式な検証結果や実機の実行結果ではありません。」
  `apps/web/lib/workspace-locale.ts:864`
- 「ソースフィンガープリント」→「ソース識別子」
  `apps/web/lib/workspace-locale.ts:866`
- 「中間表現フィンガープリント」→「変換後回路の識別子」
  `apps/web/lib/workspace-locale.ts:867`
- 「直接解析したソース」→「元のソースコードを直接実行」
  `apps/web/lib/workspace-locale.ts:869`
- 「OpenQASM標準ゲート分解 · グローバル位相の留意事項あり」→「OpenQASM標準ゲートに分解（グローバル位相は比較対象外）」
  `apps/web/lib/workspace-locale.ts:870`
- 「この同一ソース」→「同じソースコード」
  `apps/web/lib/workspace-locale.ts:875`
- 「基準ボールトバージョン」→「実行元のバージョン」
  `apps/web/lib/workspace-locale.ts:883`
- 「全サンプル測定値」→「測定結果の合計」
  `apps/web/lib/workspace-locale.ts:885`
- 「来歴と実行条件の詳細」→「実行履歴と条件」
  `apps/web/lib/workspace-locale.ts:890`
- 「単一の支配的な結果です」→「この状態が最も多く観測されました」
  `apps/web/lib/workspace-locale.ts:891`
- 「相関ペアの特徴です」→「2つの状態に測定結果が集中しています」。元の文は検証なしに相関を断定しています。
  `apps/web/lib/workspace-locale.ts:892`

### QPU・実機

- 「ハードウェアレーン」→「実機実行」
  `apps/web/lib/workspace-locale.ts:878`
- 「プロバイダー、見積り、確認、利用ポリシーが整うまで」→「料金と利用条件の準備が整うまで」
  `apps/web/lib/workspace-locale.ts:880`
- 「コントロールプレーンに接続できないため」→「サーバーに接続できないため」
  `apps/web/lib/workspace-locale.ts:897,907`
- 「無料キュー」→「無料枠」
  `apps/web/lib/workspace-locale.ts:899`
- 「ベンダー料金表 · 2026-… 確認」→「料金確認日: 2026-…」
  `apps/web/lib/workspace-locale.ts:905`
- 「プロバイダーのジョブ」→「実機ジョブID」
  `apps/web/lib/workspace-locale.ts:913`
- 「デバイスの生カウント」→「測定結果（生データ）」
  `apps/web/lib/workspace-locale.ts:915`
- 「このデプロイメントでは、オーナーにより」→「現在の環境では、管理者が」
  `apps/web/lib/workspace-locale.ts:917`
- 「このデプロイメントにはプロバイダーSDKがインストールされていないため」→ 利用者向けには「現在の環境は、この実機プロバイダーに対応していません。」
  `apps/web/lib/workspace-locale.ts:919`

### エディタ

- 「Studio表示」→「Studioの表示切り替え」
  `apps/web/lib/workspace-locale.ts:923`
- 「回路インスペクタ」→「回路の詳細」
  `apps/web/lib/workspace-locale.ts:928`
- 「ライブ下書き」→「編集中」
  `apps/web/lib/workspace-locale.ts:929`
- 「検証コントラクト」→「実行・検証の設定」
  `apps/web/lib/workspace-locale.ts:931`
- 「物理的根拠」→「期待する物理結果と一致」
  `apps/web/lib/workspace-locale.ts:932`
- 「構造的根拠」→「出力形式のみ確認」
  `apps/web/lib/workspace-locale.ts:933`
- 「公開リファレンス」→「公開データベースの検証情報」
  `apps/web/lib/workspace-locale.ts:934`
- 「完全な記録を開くと読み込まれます」→「詳細は検証記録で確認できます」
  `apps/web/lib/workspace-locale.ts:936`
- 「実行プランナーにそのまま渡します」→「正式な検証実行にも同じ値を使用します」
  `apps/web/lib/workspace-locale.ts:940`
- 「検証済みとみなす前に実行してください」→「検証済みとして保存するには実行してください」
  `apps/web/lib/workspace-locale.ts:957`
- 「合格した実行が次の保存バージョンになります」→「検証に合格すると、新しいバージョンとして保存されます」
  `apps/web/lib/workspace-locale.ts:958`
- 「Leona実行で〜を開始しました」→「Leona Runで〜を開始しました」または「〜を開始しました」
  `apps/web/lib/workspace-locale.ts:959`
- 「ベル状態スターター」→「ベル状態のサンプル」
  `apps/web/lib/workspace-locale.ts:961`
- 「ゲートをクリックして役割を確認します。」→「ゲートを選ぶと説明が表示されます。」
  `apps/web/lib/workspace-locale.ts:964`
- 「Atlas表示」→「Atlasで表示」
  `apps/web/lib/workspace-locale.ts:970`
- 「最初の永続アーティファクトバージョン」→「最初の保存バージョン」
  `apps/web/lib/workspace-locale.ts:974`
- 「根拠が添付されます」→「検証結果が保存されます」
  `apps/web/lib/workspace-locale.ts:976`
- 「均等な重ね合わせを作ります」→ 技術用語としては「等しい重ね合わせ状態を作ります」
  `apps/web/lib/workspace-locale.ts:979`
- 「|0⟩と|1⟩の間で反転します」→「|0⟩と|1⟩を入れ替えます」
  `apps/web/lib/workspace-locale.ts:980`
- 「生成コードをすべてのフレームワーク下書きに反映しました。」→「生成したコードを各フレームワークの下書きに反映しました。」
  `apps/web/lib/workspace-locale.ts:1001`
- 「このComposerで保存した」→「このエディタで作成した」
  `apps/web/lib/workspace-locale.ts:1009`
- 「ソース参照です」→「変換後のコードではありません」
  `apps/web/lib/workspace-locale.ts:1019`
- 「ビジュアルビルダー」→「回路エディタ」
  `apps/web/lib/workspace-locale.ts:1018,1021`
- 「ドラッグ&ドロップ」→ 日本語表記は「ドラッグ＆ドロップ」
  `apps/web/lib/workspace-locale.ts:1022`

## G. アカウント・共同ワークスペース

### アカウント

- 「本人情報、非公開ボールト、開けるワークスペース」→「プロフィール、非公開ボールト、アクセスできるワークスペース」
  `apps/web/lib/workspace-locale.ts:1317`
- 「あなた自身のワークスペースです。下から招待しない限り」→「個人用のワークスペースです。メンバーを招待しない限り」
  `apps/web/lib/workspace-locale.ts:1331`
- 「結果は開いて変換したり続きを作ったりできますが」→「結果は開いて変換・編集できますが」
  `apps/web/lib/workspace-locale.ts:1339`
- 「これからの結果」→「今後の実行結果」
  `apps/web/lib/workspace-locale.ts:1340-1341`
- 「ワークスペースの範囲」→「データの保存先」
  `apps/web/lib/workspace-locale.ts:1343`
- 「保存した実行と公開リファレンス」→「保存した実行結果と、Atlasから追加した項目」
  `apps/web/lib/workspace-locale.ts:1345`
- 「Atlasから保存」→「Atlasからボールトに追加」
  `apps/web/lib/workspace-locale.ts:1346`
- 「共同利用」→「共同作業」
  `apps/web/lib/workspace-locale.ts:1348`
- 「追加が必要な場合」→ 何の追加か不明です。「上限の引き上げが必要な場合」
  `apps/web/lib/workspace-locale.ts:1355`
- 「ボールト保存」→「ボールトの保存容量」
  `apps/web/lib/workspace-locale.ts:1360`
- 「Leona Quantum がエージェント実行とハードウェアに課金する仕組みです。透明性のために表示しており」→「将来予定している実行回数と実機利用の料金です。現在、支払いは発生しません。」
  `apps/web/lib/workspace-locale.ts:1369`
- 「このデプロイメント」→「現在の環境」
  `apps/web/lib/workspace-locale.ts:1371,1374`
- 「支払い方法は保持せず、誰にも請求できません。」→「支払い方法は登録されておらず、請求は発生しません。」
  `apps/web/lib/workspace-locale.ts:1373`
- 「オーナー承認の方針を透明性のために表示しています。」→「現在検討中の方針です。」
  `apps/web/lib/workspace-locale.ts:1377`
- 「GPU / QPU ハードウェア」→「GPU・QPU実行」
  `apps/web/lib/workspace-locale.ts:1384`

### 招待・共有

- 「`${workspace} に${role}として追加`」→ 助詞と空白が不自然です。「`${workspace} に ${role} として追加`」
  `apps/web/lib/workspace-locale.ts:1476-1477`
- 「すべて実行・保存・編集できます」→「すべての項目を実行・保存・編集できます」
  `apps/web/lib/workspace-locale.ts:1478`
- すでにメンバー追加済みなのに、ボタンが「参加しない」「参加をやめる」「残る」となっています。「退出」「ワークスペースから退出」「キャンセル」が状態に合います。
  `apps/web/lib/workspace-locale.ts:1483-1487`
- 「いま実行できませんでした。」→ 対象が不明です。「操作に失敗しました。もう一度お試しください。」
  `apps/web/lib/workspace-locale.ts:1490`
- 「準備ができたら開いてください（今はまだ移動していません）。」→「ワークスペースを作成しました。開くと、このワークスペースに切り替わります。」
  `apps/web/lib/workspace-locale.ts:1668`
- 退出確認の「残る」、削除キャンセルの「残す」→ どちらも「キャンセル」
  `apps/web/lib/workspace-locale.ts:1672,1681`
- 「参加している全員から見えなくなります。中の実行と保存済みアーティファクトもすべて含まれます。」→「削除すると、参加者全員がアクセスできなくなり、実行記録と保存済み回路も削除されます。」
  `apps/web/lib/workspace-locale.ts:1683`
- 「いま開いているワークスペースで作業できる人です。」→「現在のワークスペースにアクセスできるメンバーです。」
  `apps/web/lib/workspace-locale.ts:1696`
- 招待処理の「追加中…」→ 操作名に合わせて「招待中…」
  `apps/web/lib/workspace-locale.ts:1701`
- 「この人を削除できませんでした。」→「このメンバーをワークスペースから削除できませんでした。」
  `apps/web/lib/workspace-locale.ts:1717`

### 氏名入力

- 日本語UIで入力順が「名」「姓」です。日本語の一般的な順序に合わせるなら「姓」「名」にするか、ラベルを「名（First name）」「姓（Last name）」として意図を明示する必要があります。
  `apps/web/app/welcome/welcome-form.tsx:26-27`
- 「アカウントを開く前に実名が必要です。」→「利用を開始する前に氏名の登録が必要です。」
  `apps/web/app/welcome/page.tsx:23`

## H. Atlas一覧・詳細画面

- 「アルゴリズム系統」→「アルゴリズムの分類」
  `apps/web/app/repository/repository-browser.tsx:48`
- 「すべての系統」→「すべての分類」
  `apps/web/app/repository/repository-browser.tsx:50`
- 「1ゲート表示に戻す」→「元のゲート表示に戻す」
  `apps/web/app/repository/repository-browser.tsx:56`
- 「バリアント」→ 一般向けには「別バージョン」または「構成違い」
  `apps/web/app/repository/repository-browser.tsx:61-62`
- 「公開Atlasのスターはこの一覧に保存されます。」→「スターはこの端末のAtlas一覧に保存されます。」
  `apps/web/app/repository/repository-browser.tsx:65`
- 「非公開コピーは未スターで始まります。」→「ボールトに追加したコピーには、スターは引き継がれません。」
  `apps/web/app/repository/repository-browser.tsx:65`
- 「すべての参照セットに戻してください。」→「条件を解除して、すべての項目を表示してください。」
  `apps/web/app/repository/repository-browser.tsx:67`
- 「エンタングル状態」→「量子もつれ状態」または他の画面に合わせて「エンタングルメント状態」
  `apps/web/app/repository/repository-browser.tsx:98`
- 詳細画面では `entry.algorithmFamily` が日本語化されず、一覧と同じ分類でも英語表示になります。
  `apps/web/app/repository/[slug]/repository-entry-view.tsx:164`
- 「量子側の主張」→「量子手法の特徴」
  `apps/web/app/repository/[slug]/repository-entry-view.tsx:79`
- 「ネイティブスニペットはまだ公開されていません。」→「このフレームワーク向けのコードはまだありません。」
  `apps/web/app/repository/[slug]/repository-entry-view.tsx:86`
- 「この記録は具体的な回路ではありません。」→「この項目には実行可能な回路がありません。」
  `apps/web/app/repository/[slug]/repository-entry-view.tsx:87`
- `reviewedBy` のラベル「レビュー」→「レビュアー」または「確認者」
  `apps/web/app/repository/[slug]/repository-entry-view.tsx:90`
- 「万能性での役割」→「普遍量子計算での役割」
  `apps/web/app/repository/[slug]/repository-entry-view.tsx:132`
- データラベルの「約束条件」→ 文脈により「前提条件」
  `apps/web/app/repository/[slug]/repository-entry-view.tsx:136`
- 「サインインしてワークスペースを開きます。」→ ダイアログの見出しなので「サインインしてボールトに追加」
  `apps/web/app/repository/repository-export.tsx:40`
- 「検証済みの実行で続けたりできます」→「Runで実行・検証できます」
  `apps/web/app/repository/repository-export.tsx:41`
- 「この環境では認証がまだ設定されていません。」→ 利用者向けには「現在、サインイン機能を利用できません。」
  `apps/web/app/repository/repository-export.tsx:43`
- 「非公開コピーは未スターで始まります。」→「ボールトに追加したコピーにはスターは引き継がれません。」
  `apps/web/app/repository/repository-export.tsx:46`
- 「検証の境界を確認できます」→「どこまで検証済みか確認できます」
  `apps/web/app/repository/(browse)/page.tsx:27`

## I. 検証ラベル

- 「各レコードは、どのように検証されたかで分類されます。」→「各項目は、検証方法に応じて分類されます。」
  `apps/web/components/repository-verification.tsx:68`
- 「最も強い根拠の階層」→「最も信頼度の高い検証区分」
  `apps/web/components/repository-verification.tsx:68`
- 「チップは適用された個々の方法」→「各ラベルは実施した検証方法」
  `apps/web/components/repository-verification.tsx:68`
- 「強い実証」→「実測による検証」
  `apps/web/lib/repository/verification.ts:72`
- 「実測的根拠」→「実測結果」
  `apps/web/lib/repository/verification.ts:77`
- 「関連レコードからの傍証」→「関連する検証済み項目による裏付け」
  `apps/web/lib/repository/verification.ts:88`
- 「このカタログで再実行された根拠ではありません。」→「このカタログ上では再実行していません。」
  `apps/web/lib/repository/verification.ts:88`
- 「根拠ではなく出発点として」→「正しさが確認済みとはみなさず、参考情報として」
  `apps/web/lib/repository/verification.ts:99`
- 「境界事例」→ 一般的な「境界値」
  `apps/web/lib/repository/verification.ts:142`
- 「測定カウント」→「測定結果」
  `apps/web/lib/repository/verification.ts:150`
- 「TVD境界」→「TVDの許容範囲」
  `apps/web/lib/repository/verification.ts:150`
- 「大規模は推論です。」→「大規模な回路での一致は未確認です。」
  `apps/web/lib/repository/verification.ts:158`
- 「レコードの主張」→「この項目の説明」
  `apps/web/lib/repository/verification.ts:198`
- 「領域の専門知識」→「該当分野の専門知識」
  `apps/web/lib/repository/verification.ts:214`
- 「関連する検証済みレコード」→「関連する検証済み項目」
  `apps/web/lib/repository/verification.ts:222`
- 「LLMがレコードの内部整合性を確認」→「LLMで記述内容の内部整合性を確認」
  `apps/web/lib/repository/verification.ts:230`

## J. Atlas本文・技術解説

技術用語そのものは残してよい一方、次の反復パターンは編集文ではなく、英語から自動翻訳されたメタ説明に見えます。

### 全体置換が必要な反復パターン

- 「このレコード」「本レコード」「〜レコード」→「この項目」「このエントリ」、または文脈上不要なら削除
  `apps/web/lib/repository/enrichment.ts:41-223`
  `apps/web/lib/repository/entries-legacy.ts:72,451,922,1182,1369`
  `apps/web/lib/repository/entries-gates.ts:33,605,1014`
  `apps/web/lib/repository/entries-gates-2.ts:24,545`
- 「この記録」→「この項目」「この回路」
  `apps/web/lib/repository/entries-gates.ts:33`
  `apps/web/lib/repository/entries-gates-2.ts:24,545`
- 「〜の境界」→ 実際の意味に合わせて「範囲」「制約」「違い」
  `apps/web/lib/repository/entries-legacy.ts:300,381,888,1547`
- 英語式のコロン `説明します:` → 日本語の句点または「次のとおりです。」
  `apps/web/lib/repository/enrichment.ts:91-223`
- 半角括弧を日本語本文中で多用している箇所は全角括弧へ統一
  `apps/web/lib/repository/enrichment.ts:85-223`

### 個別に不自然な本文

- 「最小の参照例」→「最も基本的な例」
  `apps/web/lib/repository/entries-legacy.ts:68`
- 「最初の参照レコード」→「最初に確認する基本例」
  `apps/web/lib/repository/entries-legacy.ts:72`
- 「戻り値の契約」→「出力形式」
  `apps/web/lib/repository/entries-legacy.ts:216`
- 「シミュレータ検証の境界」→「シミュレータで検証した範囲」
  `apps/web/lib/repository/entries-legacy.ts:300`
- 「再現可能なシミュレーション証拠」→「再現可能なシミュレーション結果」
  `apps/web/lib/repository/entries-legacy.ts:377`
- 「サンプリングの境界、受入指標」→「サンプリング条件と判定基準」
  `apps/web/lib/repository/entries-legacy.ts:381`
- 「小さな最適化ワークロード」→「小規模な最適化例」
  `apps/web/lib/repository/entries-legacy.ts:381`
- 「ハードウェア最適解ではなく記録された分布チェックを公開主張とします。」→「実機上の最適性は主張せず、記録した分布の確認結果のみを示します。」
  `apps/web/lib/repository/entries-legacy.ts:385`
- 「暗号分野に関係する量子アルゴリズムを、セキュリティ上の前提とともに記録します。」→ 説明文なら「暗号に関わる量子アルゴリズムと、その安全性の前提を説明します。」
  `apps/web/lib/repository/entries-legacy.ts:569`
- 「入力ロード」→「入力データの読み込み」
  `apps/web/lib/repository/entries-legacy.ts:922`
- 「出力観測可能性」→「出力として取得できる情報」
  `apps/web/lib/repository/entries-legacy.ts:922`
- 「モデル品質とデータコストを可視化するため」→「モデルの性能とデータ準備コストを比較するため」
  `apps/web/lib/repository/entries-legacy.ts:1006`
- 「フォールトトレランス記録」→「フォールトトレランスの比較項目」
  `apps/web/lib/repository/entries-legacy.ts:1274`
- 「ワイヤ数」→ 一般向け本文なら「量子ビット数」
  `apps/web/lib/repository/entries-legacy.ts:1369`
- 「万能な合成の境界」→「普遍ゲート合成における位置づけ」
  `apps/web/lib/repository/entries-legacy.ts:1547`
- 「コンパイル上の関心」→「コンパイル時の課題」
  `apps/web/lib/repository/entries-legacy.ts:1617`
- 「Deutsch–Jozsaの補助記録」→「Deutsch–Jozsaと比較できる例」
  `apps/web/lib/repository/entries-legacy.ts:1689`
- 「Leona Quantum独自の足場」→「Leona Quantum独自のサンプル実装」
  `apps/web/lib/repository/entries-literature-expansion.ts:295`
- 「一般的な1つのスニペットを論文実装と装うのではなく」→ 強い否定がAI回答らしく見えます。「特定論文の実装ではなく、文献に基づく一般的なアルゴリズム例として掲載します。」
  `apps/web/lib/repository/entries-literature-expansion.ts:406`
- 「nビット量子ビット状態」→ 誤記です。「n量子ビット状態」
  `apps/web/lib/repository/entries-states-operators-2.ts:415`
- 本文中に英語の `relabeling` が残っています。「ラベルの付け替え」
  `apps/web/lib/repository/entries-states-operators.ts:309`
- 「無料の古典出力ベクトルではありません。」→ 英語の比喩を直訳しています。「古典的な出力ベクトル全体を追加コストなしで得られるわけではありません。」
  `apps/web/lib/repository/enrichment.ts:213`
- 「トイチェック」→「小規模な確認」
  `apps/web/lib/repository/enrichment.ts:201`
- 「1個の裸の量子ビット」→「符号化していない1量子ビット」
  `apps/web/lib/repository/enrichment.ts:205`
- 「超線形に低くなります」→「物理誤り率を上げたときの増加より速く、論理誤り率が低下します」など、意味を再確認して説明し直すべきです。現状は日本語としても技術説明としても曖昧です。
  `apps/web/lib/repository/enrichment.ts:209`

## K. 法務ページ

法務文面は自然さだけでなく法的意味の確認が必要です。以下は日本語としての修正候補であり、最終文面は専門家レビューが必要です。

- 「早期アクセスのプロダクトで」→「早期アクセス版のサービスで」
  `apps/web/lib/public-copy.ts:344`
- 「送信した問い」→「入力したプロンプト」または「入力内容」
  `apps/web/lib/public-copy.ts:347`
- 「ボールトアーティファクトの保存と再開」→「ボールトへの保存と、保存内容の再表示」
  `apps/web/lib/public-copy.ts:348`
- 「性能理解と改善」→ 文法的に不自然です。「性能の把握と改善」
  `apps/web/lib/public-copy.ts:348`
- 「可観測性」→ 利用者向けには「稼働状況の監視」
  `apps/web/lib/public-copy.ts:349`
- 「モデル利用」→「AIモデルの利用」
  `apps/web/lib/public-copy.ts:349`
- 「隔離されネットワーク制限された環境」→「ネットワークアクセスを制限した隔離環境」
  `apps/web/lib/public-copy.ts:349`
- 見出し「保持と選択肢」→「保存期間と利用者の選択」
  `apps/web/lib/public-copy.ts:351`
- 「正当な運用」→「サービスの適切な運用」
  `apps/web/lib/public-copy.ts:351`
- 「適用される義務への対応」→「法令上の義務への対応」
  `apps/web/lib/public-copy.ts:351`
- 「プロダクトの段階に応じた合理的な対策」→「サービスの現段階で合理的に可能な対策」
  `apps/web/lib/public-copy.ts:352`
- 「平易な出発点」→「現時点での基本条件」
  `apps/web/lib/public-copy.ts:387`
- 「適法に利用し」→ 目的語を補い「本サービスを適法に利用し」
  `apps/web/lib/public-copy.ts:389`
- 「文書化されたチェックが通った」→「記録された条件で、所定の検証に合格した」
  `apps/web/lib/public-copy.ts:391`
- 「利用者が持つ権利は保持されます。」→「利用者は、送信したコンテンツについて従来保有する権利を引き続き保有します。」
  `apps/web/lib/public-copy.ts:392`
- 見出し「早期アクセスのパッケージ」→「早期アクセスの提供条件」
  `apps/web/lib/public-copy.ts:393`
- 「想定パッケージ」→「提供予定のプラン内容」
  `apps/web/lib/public-copy.ts:393`
- 「有料化前に表示される条件が決済、上限、クレジット、返金を定めます。」→「決済、利用上限、クレジット、返金の条件は、有料サービスの申込み前に表示します。」
  `apps/web/lib/public-copy.ts:393`
- 「エンタープライズ関係」→「法人向け契約」
  `apps/web/lib/public-copy.ts:394`

## 修正順の推奨

1. 公開トップ、料金、お問い合わせの直訳コピーを修正する。
2. `根拠／境界／レーン／レコード／未スター` を文脈別に置き換える。
3. Studioとボールトから内部実装語を除く。
4. Atlasの共通ラベルを直し、本文中の反復パターンを一括編集する。
5. 最後に用語集を作り、`Run / Studio / Vault / Atlas / アーティファクト` の正式表記を固定する。

## 用語集のたたき台

| 英語 | 推奨日本語 |
|---|---|
| evidence | 検証結果／検証記録／裏付け |
| verification boundary | 検証範囲 |
| execution lane | 実行環境／実行方法 |
| record | 項目／エントリ／記録 |
| artifact | 保存済み回路／成果物 |
| control plane | サーバー／システム |
| deployment | 現在の環境 |
| provenance | 実行履歴／来歴 |
| fingerprint | 識別子 |
| native export | 直接エクスポート／元形式のエクスポート |
| source reference | 元のソースコード |
| attestation | 実行証明 |

## 監査範囲に関する注記

- 日本語を含む41ファイル、約1,975ヒットを確認しました。
- テストデータ、ソースコードコメント、LLMが生成した回答例そのものは、実際の固定UI文言ではないため修正候補から除外しました。
- Atlasの数式・固有名詞・標準的な量子計算用語は、単に難しいという理由では指摘していません。
- 参照PDFは全38ページをテキスト抽出し、ページ画像でも確認しました。
- この文書は分析のみです。UI実装ファイルは変更していません。

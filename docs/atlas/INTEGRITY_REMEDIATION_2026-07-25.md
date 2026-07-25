# Atlas VQE integrity remediation — 2026-07-25

## 1. 結論

Claude実装を全面破棄して過去commitへ戻す必要はない。Phase 1–4には再利用可能な
設計・corpus・UIがあり、問題は局所的に修正可能だった。ただし、修正前の状態を
そのままMVP完成または学術基盤完成と呼ぶことはできなかった。

今回の判定は次のとおり。

- **コード基盤:** targeted remediation後は継続利用可能。
- **Phase 1/2:** local acceptanceを満たす。ただしPhase 2はADR-0026の
  machine-only corpusであり、人手検証済みとは呼ばない。
- **Phase 3:** local PostgreSQLでschema/repository/APIを検証済み。
  Neon child branch検証とcurated corpus importは未実施。
- **Phase 4:** static corpusで実装・実ブラウザ検証済み。
- **MVP全体:** **未完成 / NO-GO**。Phase 5 proof executionとPhase 6
  security/scientific/E2E gateが未実施である。
- **マスタープラン全体:** 入口となるRegistry/UIの一部だけを実装した段階。
  GitHub Wrapper、structured import、execution coverage、claim reproductionは
  後続であり、量子版Hugging Faceを達成したとは主張しない。

修正前commitはlocal tag
`audit/atlas-vqe-pre-remediation-2026-07-25`で保存した。作業は
`fix/vqe-mvp-integrity`で行い、検証前の状態へ容易に戻れる。

## 2. 当初目的との整合

| 当初目的 | 今回の寄与 | 現在の限界 |
|---|---|---|
| VQEを部品に分解して俯瞰する | 12種類のtyped component、Workflow、stopping protocolを分離 | canonical Problem/Dataset browseは未実装 |
| 論文間の条件差を明示する | ScientificExperimentSpecと3件のcomparison reportを保持 | comparisonはmachine-generatedでhuman goldではない |
| 再現可能性を高める | source/evidence、immutable observation、environment digest境界を強化 | Phase 5 execution evidenceは未作成 |
| 実装がない論文も扱う | paperとrepositoryを別型にし、実装の不存在を捏造しない | corpusは26論文で、分野全体を代表する保証はない |
| 研究者が部品へ容易にアクセスする | 59件のpaper-annotated componentを検索・型filter可能にした | `paper_id:index`はbrowse keyであり永続component identityではない |
| 将来のGitHub Wrapperへ接続する | versioned ArtifactVersionをdurable identityとする境界を維持 | 実際のGitHub metadata importはまだ行っていない |

## 3. 学術的整合性の修正

### 3.1 ScientificExperimentSpecをserver-sideで構築

clientが任意のcomponent UUIDや完成済みscientific specを送る方式を廃止した。
serverはScope内のWorkflowから12種類の必須componentを解決し、欠落、重複、
型不一致、未対応role、cross-scope参照を拒否する。これにより、保存されたdigestが
clientの自己申告ではなく、Registry上のversioned compositionを表す。

### 3.2 stopping protocolを独立component化

停止条件はVQE結果とresource costを大きく左右する。従来のcomponent enumに
`stopping_protocol`がなく、同じalgorithm名でも停止条件の違う実験を十分に
識別できなかったため、ScientificExperimentSpecの独立versionとして固定した。

### 3.3 非有限値とcanonical Hamiltonian

NaN/Infinityをscientific model全体で拒否し、Hamiltonian digest計算は呼出側の
前処理に依存せず内部でcanonicalizeする。term順序が違うだけのHamiltonianは同一
digestになり、非有限値や非標準JSONによる再現不能なidentityを保存しない。

### 3.4 unknownを欠損として隠さない

nullable corpus fieldは型とruntime validatorの両方で扱い、UIでは空欄でなく
`unknown`を表示する。390×844pxの実ブラウザ検証でpaper/comparison tableの
blank cellは0だった。comparisonに表示されたunknown 33件は削除対象ではなく、
比較不能性を研究者へ見せるための情報である。

### 3.5 component browseでidentityを捏造しない

Phase 4 planの「50 componentsをfilter」を満たすため59件を一覧化した。ただし
inline literature annotationにcanonical UUIDを与えず、`paper_id:index`を
browse-only observation keyと明記した。永続identityはPhase 3 import後の
ArtifactVersionだけである。

## 4. システムエンジニアリング上の修正

- `vqe_observations`はDB triggerでUPDATE/DELETEを拒否し、app roleからも
  UPDATE/DELETE権限を除去した。APIの作法だけに依存しないappend-onlyである。
- succeeded observationにはHamiltonian digestを必須化し、外部detailの
  URI/hash/sizeをall-or-noneにした。
- request replay用`Idempotency-Key`を`request_idempotency_key`と命名し、
  Phase 5のexecution identityと分離した。
- public UI payloadはlist/detail projectionへ分離し、各static listを100件で
  fail closedにした。100件を超える前にserver paginationへ移行する。
- generated comparison JSONをAPI wheelへ同梱し、source checkoutがない環境でも
  comparison endpointが壊れないようにした。
- corpus bundleはruntimeでfail closed validationし、schema driftを空配列へ
  握りつぶさない。
- tableはdocument全体を横へ広げず、keyboard-focusableな局所scroll regionにした。

## 5. 検証結果

2026-07-25に以下を実行した。

- `uv run pytest -q`: **1064 passed / 77 skipped**。skipは環境依存suiteで、
  成功へ読み替えない。
- throwaway PostgreSQL 14:
  `test_vqe_repo_live.py` + `test_vqe_append_only_migration.py`:
  **11 passed**。
- `ruff format --check`, `ruff check`, `lint-imports`,
  `check_raw_queries.py`: 全てpass。
- corpus generator `--check`: **26 papers / 15 repositories /
  3 comparisons**、pass。
- Turbo lint/typecheck/test: **6 tasks pass**、Web **92 tests pass**。
- Next production build: **336 routes**、pass。
- API sdist/wheel build: pass。generated comparison bundle同梱を確認済み。
- actual browser:
  - 390×844pxでdocument overflowなし。
  - paper table `324→680px`、comparison table `358→960px`の局所scroll。
  - scroll regionは両方`tabIndex=0`。
  - blank table cell 0。
  - Components tabは59 cards、`compression` filterは3 cards。
  - console error 0。

DB再検証の最初の一回は、NOLOGINの権限検査用`app_rw` roleを接続userに誤指定し、
10 testが接続前に失敗した。これはproduct failureではないが隠さない。管理用の
throwaway roleへ修正した直後の同一testは11/11 passした。

既知warning:

- Next.jsが`/Users/rei/package-lock.json`をworkspace root推定に使うwarning。
- Next.js middleware convention deprecation warning。
- PennyLaneのshots API deprecation warning 4件。

いずれも今回のVQE integrity修正を失敗させるものではないが、Phase 6でwarning
budgetとupgrade issueへ登録する。

## 6. 未達事項とGo/No-Go

以下は今回修正したことにしてはならない。

1. Neon child branch migration/authz/import/reconciliation。
2. 26論文・15 repository・59 componentのDB materialization。
3. Phase 5 Qiskit/PennyLane proof execution、Studio flow、Artifact化。
4. deny-all network、credential-free runtime、resource capのE2E証拠。
5. Phase 6 dark/light screenshot regression、a11y、security/scientific gate。
6. human curation、inter-annotator agreement、manual-gold comparison。
7. corpusの代表性、網羅性、論文claim reproduction。
8. canonical Problem/Dataset entityと独立browse。
9. GitHub Wrapper provider pathとlicense-aware import。

したがって現時点の判定は、

```text
Local Phase 1–4 engineering continuation: GO
Neon promotion: OWNER APPROVAL REQUIRED
MVP product/scientific release: NO-GO
Master-plan academic claims: NO-GO
```

次は、owner承認されたtemporary Neon child branchだけを使い、migration、
authz matrix、curated import count/reconciliation、append-only、downgrade/re-upgrade
を検証する。その結果がpassしても、Phase 5–6完了前にMVP完成とは呼ばない。

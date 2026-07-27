# Atlas VQE Phase 7.6 — First Executable Component Swap

**文書version:** 1.0  
**作成日:** 2026-07-28 JST  
**対象branch:** `feature/vqe`  
**開始時Alembic head:** `0038`  
**状態:** `in_progress`（S0 verified locally; S1 in progress）  
**Authority:** Owner decision（2026-07-28）と本計画。既存ADR-0023〜0033、
Repository `AGENTS.md`、認証・Scope・sandbox規則が常に優先する。

---

## 0. このPhaseの結論

Phase 7.5で完成したのは、Component-firstのcatalog、Workflow composition
preview、compatibility previewである。交換後Workflowのimmutable保存、実行、
実測比較はまだ完成していない。

Phase 7.6ではComponent数を増やさず、次の一本だけを最後まで通す。

> H₂ fixed-excitation VQEについて、OptimizerだけをSciPy bounded scalarから
> SLSQPへ交換し、交換後Workflowを新しい科学identityとして保存し、baselineと
> candidateを同一protocolで実行し、比較結果と証拠をappend-onlyに保存して
> Studioから再閲覧できるようにする。

これを満たすまで、Phase 7.5を「標準Component MVP complete」と呼ばない。
公開実行、verified scientific badge、advanced Component intakeも開始しない。

---

## 1. Owner decisions

### 1.1 固定すること

- 最初の交換対象は`parameter_optimizer`だけとする。
- Problem、Hamiltonian、Mapping、Reference、Ansatz、Measurement、
  Evaluation、Compilation resource protocolを固定する。
- QiskitとPennyLaneはstate evaluator/runtimeの候補であり、SciPy Optimizer、
  PySCF preparation、Atlas-neutral protocolの提供元ではない。
- Definitionの科学的意味、Implementationの実装責任、Configurationの実験値を
  分離する。
- clientは実行authorityを持たない。互換性、Registry resolution、runtime、
  adapter、conversion pathはserverが解決する。
- 既存`Artifact` / `ArtifactVersion` identity、`vqe_experiments`、
  `vqe_executions`、`vqe_observations`を再利用し、同じ責務の並行tableを作らない。
- 既存の29件は、Neonへimmutable materializationされるまでは
  `standard component seed candidates`と呼ぶ。
- 現在の比較3件は結果ではなく`ControlledComparisonSpec`候補と呼ぶ。

### 1.2 このPhaseで増やさないもの

- 新規Paper、Repository、HamLib instance
- CEO-ADAPT、TETRIS、HA-ADAPT、OBS、pruning
- LLM/Transformer Component
- finite-shot、mitigation、QPU/GPU
- 任意GitHub code実行、dynamic install
- 新しいCompression
- LiH以上の分子
- public publication、verified badge

### 1.3 実装順序に関する補正

全Component typeの完全ontologyを先に作らない。次の順で縦に完成させる。

```text
claim correction
→ H₂ sliceに必要なtyped scientific identity
→ role別Implementation Binding
→ server-authoritative compatibility
→ swapped Workflow Instance保存
→ QiskitでOptimizer swap実行
→ comparison保存
→ PennyLaneで再現
→ Neon / WorkOS / runtime E2E
→ 一般化
```

この順序は、巨大schemaを作ったまま実行証拠が得られない状態を避けるための
engineering gateである。

---

## 2. 現在の既知の不整合

Phase 7.6開始時に、次を既知の問題として固定する。

| ID | 問題 | 影響 | 優先度 |
|---|---|---|---|
| P76-01 | 14 Component × 2 frameworkを28 executable bindingとして生成 | 実装責任とEvidenceの誤帰属 | P0 |
| P76-02 | Definition自体に実行可能性を持たせる | 科学定義とruntime状態の混同 | P0 |
| P76-03 | 交換後は`changedRoles.length > 0`で実行不可 | Composerがpreviewに留まる | P0 |
| P76-04 | Studioへbaseline Registry keyを送る | 交換後Workflowを実行できない | P0 |
| P76-05 | 比較SpecをControlled Comparisonと表示 | 実測済みに見える | P0 |
| P76-06 | requires/providesが文字列token | false-compatibleの可能性 | P1 |
| P76-07 | swap時にConfigurationとbindingを空にする | 条件消失・比較不能 | P1 |
| P76-08 | UCCSD/HEでもPool/Search/Growthが残る | role applicabilityの矛盾 | P1 |
| P76-09 | H₂ identityにgeometry等が不足 | 同一条件を証明できない | P1 |
| P76-10 | 一つのglobal providerを全roleへ要求 | 実際のprovider責任を表現できない | P1 |
| P76-11 | seed catalogがRegistryへ未materialize | 永続ID・履歴・API再取得がない | P1 |
| P76-12 | local previewとlive full E2Eが分離 | 製品flowの証拠がない | P1 |

P0を残したままS2以降へ進まない。

---

## 3. 最初のControlled Swapの科学protocol

### 3.1 固定Workflow

```text
Problem Instance:
  H₂ / STO-3G / fixed geometry

Preparation:
  frozen canonical Hamiltonian fixture

Representation:
  Jordan–Wigner

Reference State:
  Hartree–Fock

Ansatz:
  fixed one-parameter excitation

Pool / Search / Growth:
  existing fixed singleton protocol

Measurement:
  exact statevector energy objective

Evaluation:
  exact reference comparison

Compilation:
  canonical ansatz-only logical resource protocol
```

geometry、Hamiltonian digest、ordering、initial parameter、bounds等の値は、
既存のqualified H₂ fixtureとruntime adapterからS0で抽出して
`H2_OPTIMIZER_SWAP_PROTOCOL.json`へ固定する。計画書中で推測して埋めない。
一つでも復元できない値があればS0は`blocked_owner`または
`blocked_external`とし、実行へ進まない。

### 3.2 変更するComponent

```text
Baseline:
  SciPy bounded scalar optimizer

Candidate:
  SciPy SLSQP optimizer
```

SLSQPをQiskit/PennyLane implementationとして登録しない。

### 3.3 共通budget

Optimizer固有のiterationの意味は一致しないため、同一iteration数を
比較条件にしない。共通budgetとして次を固定する。

- maximum objective evaluations
- maximum gradient evaluations（非使用なら0を記録）
- maximum wall-clock duration
- finite-energy requirement
- accepted energy-error threshold
- parameter bounds
- initial-point policy
- deterministic seed policy
- trajectory recording policy

数値はS0のbaseline監査と小規模校正で決め、Owner decisionとしてprotocol
versionへ記録する。baselineに有利な事後変更は禁止する。

### 3.4 保存する観測

- best/final energy
- absolute error against fixed reference
- converged flagとtermination reason
- objective/gradient evaluations
- optimizer iterations
- wall time
- initial/final parameterとdigest
- bounded trajectory
- non-finite observation count
- state fidelity（同一最適状態を比較可能な場合）
- CNOT、CNOT depth、total depth、parameter count
- circuit digest
- evaluator/runtime profile
- package、adapter、container digest、architecture

Optimizerだけを交換するので、論理回路resourceは一致することが期待される。
一致しない場合は「性能差」ではなく`comparability_failed`として扱い、原因を
解決するまで比較結果を成立させない。

---

## 4. 状態モデル

実行可能性を一つの`status`へ圧縮しない。

### 4.1 Definition maturity

```text
draft
structured
reviewed
```

### 4.2 Implementation evidence

```text
documented
adapter_tested
runtime_qualified
```

### 4.3 Workflow lifecycle

```text
draft
invalid
compatible
executable
executed
comparison_eligible
```

### 4.4 Binding kind

```text
provider_native
atlas_adapter
neutral_protocol
dataset_snapshot
runtime_observed
documented_only
```

`runtime_qualified`は、特定のpackage × version × capability × runtime ×
adapterについて得られたEvidenceである。他Componentや別versionへ伝播させない。

---

## 5. データ責務

新tableを設計する前に、既存責務との対応表を作る。

| 概念 | 既存の保存先または方針 |
|---|---|
| Component Definition Version | `artifacts` + `artifact_versions` + `vqe_component_specs` |
| Workflow Template/Instance Version | Workflow `ArtifactVersion` + `vqe_workflow_components` |
| Scientific experiment | `vqe_experiments` |
| Runtime execution | `vqe_executions` |
| Append-only result/evidence | `vqe_observations` |
| Source snapshot/candidate | Phase 7のsource/evidence staging |
| Comparison Spec/Run | 既存責務監査後、additive relationとして最小追加 |

`WorkflowInstance`は新しい独立identity tableではなく、原則として新しい
Workflow `ArtifactVersion`として表す。比較tableが必要な場合も、baselineと
candidateのArtifactVersion・executionを参照し、結果payloadを複製しない。

Migration番号は実装開始時の実Alembic headから採番し、この文書では予約しない。

---

## 6. Step-by-step execution plan

各Stepは順番に行う。`implemented`だけでは次へ進まず、指定された検証を通して
`verified_local`または`verified_neon`になってから次へ進む。

### S0 — Baseline freezeとclaim inventory

**目的:** 変更前の事実と、比較に使うH₂ protocolを固定する。

**作業**

1. branch、commit、Alembic head、lockfile、runtime image digestを記録する。
2. 29 definitions、28 bindings、7 templates、3 comparisonsがどのコードから
   生成されたかをmachine-readable inventoryへ出す。
3. H₂ fixtureからProblem、Hamiltonian、ordering、Ansatz、bounds、
   initial-point、exact reference、resource protocolを抽出する。
4. 現在のQiskit/PennyLane baselineを変更せず再実行し、raw resultを保存する。
5. UI、generated JSON、progress文書の全claimを一覧化する。

**成果物**

- `docs/atlas/evidence/phase76/baseline_manifest.json`
- `docs/atlas/evidence/phase76/H2_OPTIMIZER_SWAP_PROTOCOL.json`
- `docs/atlas/evidence/phase76/claim_inventory.json`
- baseline command logとdigest

**学術ゲート**

- H₂ Problem identityの必須値にunknownがない。
- 実行していないものをruntime-qualifiedと数えない。

**工学ゲート**

- worktreeがcleanな基準commitから取得されている。
- protocol JSONのcanonical digestが再生成で一致する。

**Rollback**

- 読み取りとEvidence追加のみ。既存runtime・DB・UIは変更しない。

---

### S1 — P0表示・用語・Evidence帰属修正

**目的:** 現在の能力以上の表示を直す。

**作業**

1. `canonical components`を`standard component seed candidates`へ変更する。
2. Definitionから`executable`表示を外す。
3. 28 bindingsのcartesian productを廃止し、実責任で再分類する。
4. `ControlledComparison`を`ControlledComparisonSpec`または
   `ComponentSwapPlan`へ変更する。
5. UIの「検証済み標準部品」を、Definition maturityとImplementation
   evidenceを区別する文言へ変更する。
6. generated JSON、TypeScript contract、tests、progress文書を同期する。

**テスト**

- generated catalog `--check`
- Python model/fixture tests
- TypeScript typecheck
- UI unit tests
- snapshotに旧過大表現がないこと

**完了条件**

- PySCF、SciPy、Atlas protocol、dataset fixtureがQiskit/PennyLane nativeとして
  表示されない。
- 比較Specと実測RunがUI/API/schema上で区別される。
- 件数KPIがEvidenceの強さを代替しない。

**Rollback**

- 旧generated bundleを復帰できる。ただし旧過大claimを公開面へ戻さない。
  必要ならComponent UI全体をread-only structured previewへ落とす。

---

### S2 — H₂ sliceのtyped scientific schema

**目的:** 最初の交換に必要な科学identityを曖昧な文字列tokenから分離する。

**方針**

全Component typeを同時に完全化しない。まず次だけをstrict schema化する。

- `ProblemInstanceSpec`
- `MappingSpec`
- `ReferenceStateSpec`
- `AnsatzSpec`（fixed one-parameter slice）
- `OptimizerSpec`
- `MeasurementProtocolSpec`
- `EvaluationProtocolSpec`
- `CompilationProtocolSpec`

UCCSD、ADAPT、generalized pool等は、必須fieldが不足する限り`structured`に
留め、無理にdefaultを発明しない。

**必須identity**

- Problem: geometry/unit/charge/multiplicity/basis/active/frozen space、
  orbital convention、Hamiltonian digest、reference energy
- Mapping: mathematical convention、orbital/spin/qubit ordering、tapering
- Reference: occupation convention、particle/spin sector、qubit ordering
- Ansatz: generator、orientation、normalization、ordered generator digest、
  parameter slots、initial state relation
- Optimizer: objective interface、bounds、initial-point、budget、tolerances、
  deterministic settings
- Measurement: exact/shot、observable representation、estimator、seed、cost model
- Compilation: metric stage、basis、topology、compiler/version、optimization、
  seed、parameter-binding stage

**成果物**

- pure `majorana_vqe` model
- schema versionとcanonicalizer
- positive/negative/golden digest fixtures
- legacy seed → typed payload migration function

**テスト**

- unknown field fail-closed
- provider/framework/path/codeが科学identityへ入らない
- field順序に依存せずdigest一致
- semantic payload差でdigestが変化
- legacy unknownをdefaultで埋めずvalidation failureにする

**完了条件**

- H₂ baseline/candidateに使う全Definitionがtyped schemaを通る。
- 同名で異なるsemanticsを同一digestにしない。

**Rollback**

- schema v0.1を削除・上書きせず、v0.2を別versionとして追加する。
- read pathは一時的にv0.1 structured-onlyを表示できるが、v0.1から新規実行しない。

---

### S3 — Role applicabilityとCompatibility Engine v2

**目的:** Workflowごとに必要なroleを正しく表現し、serverで判定する。

**作業**

1. roleへ`required / optional / not_applicable / forbidden`を導入する。
2. requires/providesをtyped portへ移す。
3. Workflowをrole付きDAGとして検証する。
4. num_qubits、electron count、mapping、ordering、parameter slots等をunifyする。
5. Configuration schemaを検証する。
6. client checkerは説明用previewとし、server resultをauthorityにする。
7. v1/v2 checkerをshadow modeで同じfixturesへ適用し、差を記録する。

**Fixed/ADAPT/UCCSDの境界**

- 現行fixed-excitation protocolでPool/Search/Growthを明示的に使用するなら
  `required`とし、その科学的責務をtyped specへ記述する。
- UCCSD/Hardware-Efficientではそれらを`not_applicable`とする。
- ADAPTではPool/Search/Growthを`required`とする。
- 一つのrole集合を全Workflowへ強制しない。

**Configuration migration**

```text
old configuration
→ common compatible fields
→ validation
→ dropped/incompatible field report
→ explicit acceptance
→ new configuration digest
```

空配列へのsilent resetは禁止する。

**完了条件**

- incompatible、unknown、not_applicableを別reason codeで返す。
- false-compatible fixtureが0件。
- client/server判定差が0件。
- H₂ Optimizer swapがcompatibleになる。

**Rollback**

- v2判定をfeature flagでread-only shadowへ戻せる。
- v1を実行authorityへ戻す場合、交換実行を全面disableする。

---

### S4 — Component単位Implementation Binding

**目的:** global provider選択を、実際のrole責任へ分解する。

**作業**

1. Component Implementation Bindingへprovider、package、exact version、
   binding kind、source snapshot、supported configuration subset、
   evidence level、runtime profile、known incompatibilitiesを持たせる。
2. H₂ sliceの各roleへ、実際に使用するbindingだけを登録する。
3. Qiskit/PennyLaneはstate evaluator/circuit adapterへ限定する。
4. OptimizerはSciPy bindingとする。
5. neutral protocol/dataset snapshotをframework nativeとして数えない。
6. server-side `ExecutablePlan` resolverを実装する。

**重要な境界**

role別bindingを導入しても、最終的なcircuit/estimator runtimeは一つを選ぶ。
「複数providerを使える」と「一回の量子評価を複数frameworkへ分割する」を
混同しない。

**完了条件**

- H₂ baselineとcandidateについて一意なExecutablePlanを解決できる。
- ambiguous/missing bindingはfail-closed。
- clientがpackage versionやcontainer digestを指定できない。

**Rollback**

- 新resolverをdisableし、既存qualified H₂ baselineのみ実行可能に戻す。

---

### S5 — Swapped Workflow Instanceのimmutable保存

**目的:** UI draftをbaseline keyの再利用ではなく、新しい科学identityへする。

**API flow**

```text
Client Workflow Draft
→ server-side schema validation
→ compatibility v2
→ Implementation Plan resolution
→ Workflow ArtifactVersion作成
→ vqe_workflow_components作成
→ portable scientific digest
→ experiment creation
```

**Clientが送信できるもの**

- Component semantic key + expected content digest
- implementation preference（許可された範囲）
- bounded Configuration values
- request idempotency key

**Clientが送信できないもの**

- Registry UUID
- runtime/container digest
- adapter release
- source workspace
- arbitrary package/version
- conversion path

**保存するもの**

- template ArtifactVersion
- selected Component ArtifactVersions
- configuration digests
- Implementation bindings
- compatibility report digest
- portable scientific digest
- creator/workspace

**完了条件**

- baselineとcandidateが別Workflow ArtifactVersionになる。
- 同一request replayは同一結果を返す。
- 同じ科学payloadは同一portable digestを持つ。
- workspace Scopeを越えて存在確認できない。
- 非互換draftはexecutable Workflowとして保存されない。

**Rollback**

- POST endpointをdisableし、read-only catalogへ戻す。
- 作成済みimmutable ArtifactVersionは削除・書換えせず、利用停止状態を別記録する。

---

### S6 — SLSQP adapterと共通budget

**目的:** candidate Optimizerを最小の新Componentとして実行可能にする。

**作業**

1. SciPy bounded scalar adapterの実際のobjective contractを監査する。
2. SLSQP adapterを同じobjective contractへ実装する。
3. initial point、bounds、objective-call hard cap、timeoutをprotocolで固定する。
4. callback/trajectoryをbounded evidenceとして記録する。
5. non-finite、budget exhausted、optimizer failureをterminal reasonへ変換する。
6. SciPy exact versionとruntime imageを固定する。

**テスト**

- analytic one-parameter objective
- boundary optimum
- non-finite objective
- hard budget exhaustion
- timeout/cancellation
- deterministic replay
- objective-call accounting

**完了条件**

- 両Optimizerが同じobjective adapterを使う。
- budget counterがframework側とoptimizer側で二重計上されない。
- failureをconvergenceとして扱わない。

**Rollback**

- SLSQP capabilityだけをunqualifiedへ戻せる。
- baseline bounded scalar executionは影響を受けない。

---

### S7 — Qiskit local vertical E2E

**目的:** 最初の実測Optimizer swapを一つのstate evaluatorで成立させる。

**flow**

```text
compose
→ server validate
→ baseline/candidate Workflow保存
→ Qiskit ExecutablePlan解決
→ baseline実行
→ candidate実行
→ observations保存
→ invariant audit
```

**比較成立条件**

- changed roleがOptimizerだけ
- fixed scientific digestsが全て一致
- circuit digest/resource metricsが一致
- 共通budget protocolが一致
- 両実行がfinite resultを返す
- 結果contractがschemaを通る

**判定**

- Energyが良い方を「優れたVQE algorithm」とは呼ばない。
- Optimizer under fixed H₂ protocolの観測差として報告する。
- budget差、termination差、runtime差を併記する。

**完了条件**

- raw executionとcomparison auditを再生成できる。
- 失敗を除外して成功例だけを残さない。
- 同じcommit/runtimeで再実行可能。

**Rollback**

- Qiskit candidate capabilityをdisableし、証拠はappend-onlyで保持する。

---

### S8 — ControlledComparisonSpec / Run永続化

**目的:** 比較計画と実測結果を別entityとして保存する。

**ControlledComparisonSpec**

- baseline/candidate Workflow ArtifactVersion
- changed role
- fixed scientific digests
- Configuration diff
- metric/budget protocol version
- comparability preconditions

**ControlledComparisonRun**

- Spec reference
- baseline/candidate execution reference
- metric observations
- invariant audit
- status
- failure/inconclusive reasons

**status**

```text
planned
running
comparable
comparability_failed
inconclusive
failed
```

**DB方針**

- 既存Artifact/experiment/execution/observation責務を複製しない。
- additive migrationのみ。
- update/deleteを許可せず、訂正は新しいRunとして記録する。
- downgradeはデータ存在時にfail-closed。

**完了条件**

- Specだけを結果として表示できない。
- 一つ以外のrole/configが変わると`comparability_failed`。
- baseline/candidate executionをScope付きで再取得できる。

**Rollback**

- comparison write APIをdisableする。
- 既存append-only resultは保持する。

---

### S9 — PennyLane replication

**目的:** Optimizerとstate evaluatorの責務分離を確認する。

S7と同じWorkflow pair、scientific digest、budget protocolを使用し、
state evaluator bindingだけをPennyLaneへ変えて実行する。

**監査**

- Qiskit/PennyLaneでHamiltonian、parameter orientation、reference state、
  energy conventionが一致する。
- evaluator差をOptimizer差へ混入させない。
- cross-evaluator agreement toleranceは実行前に固定する。

**完了条件**

- 両evaluatorでbaseline/candidateを実行済み。
- 同一科学specと別ExecutionBindingの境界が維持される。
- 不一致は`inconclusive`として保存され、平均化や隠蔽をしない。

**Rollback**

- PennyLane bindingだけをunqualifiedへ戻す。

---

### S10 — UI / Studio compose → compare → reopen

**目的:** preview UIを実行可能Composerへ進める。

**UI flow**

1. H₂ fixed-excitation templateを選ぶ。
2. Optimizerをbounded scalarからSLSQPへ交換する。
3. changed role、Configuration diff、fixed invariantsを表示する。
4. server compatibility resultを表示する。
5. baseline/candidate Workflowを保存する。
6. private executionを要求する。
7. Comparison SpecとRunを別表示する。
8. 保存済み比較を再度開く。

**UIで明示する状態**

- structured seed
- implementation documented
- adapter tested
- runtime qualified
- compatible
- executable
- executed
- comparison eligible

**完了条件**

- baseline Registry keyをcandidateに再利用しない。
- client-side判定だけでRun buttonを有効にしない。
- loading、failed、inconclusive、cancelledが終端表示される。
- mobile/desktopでfixed/changed/unknownを確認できる。

**Rollback**

- Composer write/run actionsをfeature flagで隠し、read-only Component catalogへ戻す。

---

### S11 — Neon materializationとmigration validation

**目的:** seed候補、Workflow Instance、Comparison evidenceをtest Neonへ保存する。

**作業**

1. 実Alembic headを確認してmigrationを作る。
2. disposable Neon branchでup → down → upを検証する。
3. seed importerをidempotentにする。
4. static bundleとNeonのsemantic digestを照合する。
5. Scope、append-only、duplicate、concurrencyを検証する。
6. seed候補をArtifactVersion-backed Definitionへmaterializeする。

**完了条件**

- importerを2回実行して重複なし。
- migration single head。
- data存在時の危険なdowngradeはfail-closed。
- public publicationは行わない。
- source/evidence relationが失われない。

**Rollback**

- test Neon branchを破棄できる。
- main/production DBへmigrationを適用しない。

---

### S12 — Authenticated full E2EとPhase close

**目的:** WorkOS → Web → API → Neon → durable worker → digest-pinned runtime →
Comparison再閲覧を一つの連続flowとして証明する。

**必須flow**

```text
WorkOS Staging login
→ private Component catalog
→ H₂ template
→ Optimizer swap
→ API validation
→ Workflow ArtifactVersion保存
→ Qiskit baseline/candidate
→ PennyLane baseline/candidate
→ Comparison Run保存
→ private Artifact
→ logout/login
→ Comparison再閲覧
```

**security gate**

- deny-all egress
- credentialなしruntime
- non-root/read-only filesystem
- bounded CPU/memory/time/output
- server-resolved digest-pinned OCI
- workspace Scope enforcement
- no secrets in logs/artifacts

**scientific gate**

- fixed digest audit pass
- exactly-one-role change
- raw observations preserved
- failure/inconclusive preserved
- version/evidence provenance visible

**Phase close条件**

- S0〜S12が指定状態を満たす。
- rollback drillを一回実行する。
- `PHASE76_PROGRESS.md`へ実測command/resultを記録する。
- 旧Phase 7.5文書の過大claimをhistorical correctionとして更新する。
- OwnerがPhase 7.7開始を明示承認する。

---

## 7. Test matrix

| Layer | 必須検証 |
|---|---|
| Pure models | schema、extra forbid、canonical digest、legacy migration |
| Compatibility | typed ports、applicability、configuration、reason codes |
| Binding resolver | missing/ambiguous/unsupported、server authority |
| Repository | Scope、idempotency、append-only、concurrency |
| API | auth、invalid draft、replay、terminal errors |
| Runtime | budget、timeout、OOM、non-finite、digest、deny-all |
| Scientific | energy、trajectory、circuit equality、exact reference |
| Comparison | exactly-one-change、fixed digests、Spec/Run separation |
| Web | state labels、server result、save/run/reopen、responsive |
| Migration | single head、up/down/up、data-present fail-closed |
| Live E2E | WorkOS→Neon→runtime→reopen |

全件数の増加は成功条件にしない。各testは、何のclaimを支えるEvidenceかを
manifestに記録する。

---

## 8. Git / change control

各Stepを一つ以上の独立commitに分ける。

```text
docs: freeze Phase 7.6 baseline
fix: correct VQE component evidence labels
add: type the H2 optimizer swap protocol
add: validate VQE role applicability
add: resolve per-component VQE bindings
add: persist composed VQE workflows
add: execute the H2 SLSQP swap
add: persist controlled VQE comparisons
add: replicate the optimizer swap in PennyLane
add: complete private VQE swap E2E
```

- unrelated changeを混ぜない。
- migration、auth、sandbox、generated contractはCODEOWNER/Owner review対象。
- 各Step開始前後に`git status`とdiff scopeを監査する。
- `feature/vqe`から直接`dev`/`prod`へmergeしない。
- pushはOwnerの明示依頼がある場合だけ行う。
- public化、課金、credential変更は別Owner approvalを必要とする。

---

## 9. Go / No-Go gates

### Phase 7.6 GO

```text
[ ] P0 claim correction済み
[ ] H₂ scientific protocol digest固定
[ ] typed schemaでbaseline/candidateが有効
[ ] role別bindingが一意
[ ] swapped Workflowが新ArtifactVersion
[ ] Qiskit comparison comparable
[ ] PennyLane comparison comparableまたは正直にinconclusive
[ ] Comparison Spec/Run分離
[ ] Neon idempotent persistence
[ ] authenticated full E2E
[ ] rollback drill
```

### Phase 7.7 NO-GO条件

- 28 bindingの誤帰属が残る
- clientが実行authorityを持つ
- baseline keyをcandidateへ再利用する
- configurationをsilent resetする
- Comparison Specを結果として表示する
- exactly-one-role invariantを検証できない
- runtime evidenceが別Componentへ伝播する
- live E2Eを複数の部分試験から推定する
- public/verified claimを行う

---

## 10. Phase 7.7以降

Phase 7.6完了後にだけ、provider-neutral compositionへ進む。

### Phase 7.7

- Canonical fermionic/qubit Hamiltonian
- Canonical state preparation/parametric circuit
- role別provider binding
- conversion graph
- adapter version/input-output digest/equivalence evidence
- OpenFermion → Qiskit/PennyLane変換

### Phase 7.8

次の順で一件ずつ追加する。

1. COBYLA
2. H₂ UCCSD
3. H₂ Hardware-Efficient
4. LiH Problem Instance
5. selected HamLib Problem Instance
6. Standard ADAPT-VQE
7. finite-shot estimator

新Componentは、実行可能Workflow、controlled comparison、interoperability
evidence、unknown解消、version-drift testのいずれかを一つ増やす場合だけ追加する。

---

## 11. Definition of Done

Phase 7.6を完了と呼べるのは、次をすべて満たす場合だけである。

```text
[ ] 表示とEvidence帰属が正確
[ ] seed候補とRegistry Definitionを区別
[ ] H₂ Problem/Mapping/State/Ansatz/Optimizer/Measurement/Compilationがtyped
[ ] role applicabilityが明示
[ ] server-authoritative compatibility
[ ] per-component Implementation Binding
[ ] candidate Workflowが新しいimmutable ArtifactVersion
[ ] baseline/candidateを実行
[ ] exactly-one-role invariantを監査
[ ] ControlledComparisonSpecとRunを分離
[ ] QiskitとPennyLaneのEvidenceを別Bindingとして保存
[ ] Neonへidempotent materialization
[ ] WorkOS→API→DB→runtime→compare→reopen E2E
[ ] failure/inconclusiveを保持
[ ] rollback済み
[ ] public/verified claimをしていない
```

このDefinition of Doneを満たして初めて、Atlas VQEをcatalog prototypeではなく、
最初の`Executable Component Swap`を持つplatformと表現できる。

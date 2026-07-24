# Atlas VQE MVP 実行計画

**文書version:** 1.1  
**作成日:** 2026-07-24 JST  
**対象Repository:** `EshMis/majorana`  
**基準commit:** `4ade53faf37443c90980f7515bbbb83b836240db`  
**作業branch:** `feature/vqe`  
**基準Alembic head:** `0034`  
**状態:** approved for phased planning; implementation not started  
**長期構想:** `atlas_vqe_github_wrapper_master_plan_ja.md`

---

## 0. この文書の目的

この文書は、長期マスタープランを一度に実装せず、研究者が実際に使える
VQE MVPを先に完成させるための実行計画である。

MVPの優先順位は次のとおり。実行機能はAtlasの中心ではなく、Registryに
保存された科学metadataから同一実験を再構成できることを示す証拠である。

```text
VQE Component Schema
→ 手動review済みCurated Registry
→ Browse / Compare UI
→ ScientificExperimentSpecからの再構成
→ Qiskit/PennyLaneによる検証証拠
→ GitHub Wrapperをmetadata-onlyで追加
→ 外部Repository実行は十分な隔離後
```

この順序を変更して、最初から大量のGitHub Repository取得、巨大ontology、
GPU、QPU、古い論文環境の実行へ進んではならない。

## Phase overview

| Phase | Outcome | DB | UI | Current status |
|---|---|---:|---:|---|
| 0 | ADR + H2/Qiskit/PennyLane executable spike | no | no | complete |
| 1 | Component/Workflow/Scientific Experiment schema | no | no | complete |
| 2 | 25 papers / 15 repositories / 50+ components curated corpus | no | no | blocked_owner (mechanics done: 26/15/59; human-review not started) |
| 3 | Component Registry + experiment evidence in Neon | yes | contract only | not_started |
| 4 | Atlas Browse / Compare UI | Phase 3 | yes | not_started |
| 5 | Qiskit/PennyLane runtime + Studio proof execution | Phase 3 | yes | not_started |
| 6 | Security/scientific/E2E hardening and MVP Go/No-Go | test only | test | not_started |
| 7 | Manual GitHub metadata import | later | minimal | later |
| 8–9 | Deterministic/LLM extraction and reviewed materialization | later | later | later |
| 10 | Isolated external Repository execution | separate milestone | later | prohibited in MVP |

**Active pickup:** owner review of Phase 2 corpus (`docs/atlas/corpus/`,
`docs/atlas/PHASE2_PROGRESS.md`)。Phase 0/1はowner-approved/complete
(2026-07-24)。Phase 2は corpus mechanics (26 papers / 15 repositories / 59
components) まで完了したところでowner stopに到達 — human-reviewed判定
(Claude自身を人間reviewerとして数えない)、inter-annotator agreement、3件の
manual-gold comparison reportはowner/human actionが必要なため未着手。
Phase 3のNeon Component Registryは、Phase 2の80%人間review宣言と
comparison reportsが揃うまで開始しない。

---

# Part I. Fixed decisions

## 1. MVPの一文

> 研究者がVQE論文・実装をversioned component単位で検索・比較し、条件の
> 一致・不一致・不明点と再現性evidenceを確認でき、少なくとも一つの標準
> ScientificExperimentSpecをQiskitとPennyLaneで再実行して検証証拠まで
> 確認できる。

## 2. MVPで必ず実現するもの

1. Framework非依存の`ScientificExperimentSpec v0.1`。
2. `ExecutionBinding`を科学specから分離。
3. versioned VQE Component/Workflow schema。
4. 25本以上の論文、15件以上の実装Repository、50件以上のcomponent。
5. curated corpusの80%以上を人間review。
6. 3組以上のcurated comparison report。
7. Atlas Browse / Compare UI。
8. 不明・矛盾・比較不能理由の明示。
9. Canonical Hamiltonian表現とdigest。
10. Qiskit/PennyLane CPU runtime profile。
11. H2の独立承認済みgolden fixture。
12. exact/statevector execution。
13. 実行結果、metric semantics、environment digestの永続化。
14. durable job、retry、append-only observation。
15. Studio UIからのproof executionとArtifact化。
16. deny-all network、credentialなし、resource cap付きruntime。
17. schema、annotation guideline、curated corpusのmachine-readable保存。

## 3. MVPに含めないもの

- 任意GitHub Repository codeの実行
- GitHub App installation
- 自動論文検索
- 自動GitHub Repository discovery
- LLM metadata extraction
- PySCFによる任意分子生成
- geometry optimization
- ADAPT-VQE
- Tangelo、OpenVQE、CUDA-QX
- GPU
- 実QPU submission
- finite-shot結果を科学的合格条件にすること
- claim-level paper reproduction
- 100k件Atlas検索
- author claim/reviewer UI

これらは後続phaseで追加する。

## 4. 研究者向けMVP user flow

### Pillar 1 — Browse

```text
Atlasを開く
→ Method / Component / Problem / Evidenceで絞り込む
→ 論文・Repository・paper-associated commitを見る
→ Ansatz / Pool / Optimizer / Measurement等の構成を見る
→ unknown / conflicting / not_reportedを見る
```

### Pillar 2 — Compare

```text
二つ以上のWorkflow/論文を選ぶ
→ fixed / changed / unknown条件を見る
→ strict / controlled / partial / invalidを見る
→ 比較不能理由とmetric definition差を見る
```

### Pillar 3 — Verify

```text
標準H2 Workflowを選ぶ
→ 同じScientificExperimentSpecを確認する
→ QiskitまたはPennyLane executionを要求する
→ serverがapproved ExecutionBindingを解決する
→ energy / exact error / resource metricsを見る
→ runtime/profile/evidenceを見る
→ Artifactとして保存・比較する
```

エラー時にはspinnerを続けず、次のいずれかを表示する。

```text
invalid_spec
unsupported_capability
runtime_unavailable
runtime_timeout
runtime_oom
execution_failed
result_contract_failed
numerical_mismatch
inconclusive
```

---

# Part II. Architecture boundaries

## 5. 既存Majoranaから再利用するもの

| 既存要素 | MVPでの利用 |
|---|---|
| `runs` | user/workspace scopedな実験実行identity |
| `jobs` | lease、heartbeat、retry、dead-letter |
| `run_events` | append-only progressとfailure |
| `verification_records` | 検証method/result/details |
| `artifacts` / `artifact_versions` | 成功結果のimmutable保存 |
| `framework_variants` | Qiskit/PennyLane表現 |
| `candidate_conversions` | 将来の変換evidenceとの接続 |
| `qpu_runs` | 後続hardware evidenceで再利用 |
| repository layer | 全DB accessとScope enforcement |
| sandbox | deny-all実行境界 |
| generated contracts | API/UI contract同期 |

既存tableと同じ責務の新tableを作ってはならない。

## 6. 新しい責務

### Pure VQE domain package

候補:

```text
packages/py/vqe/
  src/majorana_vqe/
    models.py
    canonical.py
    comparison.py
    protocol.py
  tests/
```

制約:

- Qiskit/PennyLaneをimportしない。
- FastAPI/SQLAlchemyをimportしない。
- immutable Pydantic modelまたはfrozen dataclass。
- canonicalizationはdeterministic。
- schema versionを必ず持つ。

### Runtime adapters

```text
runtimes/vqe/qiskit-current/
runtimes/vqe/pennylane-current/
```

root `uv` workspaceへ無条件追加しない。各runtimeを独立lockする。

### API/Worker integration

APIはscientific specを検証・保存し、requested capabilityをserver-side support
matrixでapproved runtimeへ解決する。requestの`runtime_profile_key`、digest、
arbitrary provider versionを信用してはならない。Workerはcredentialなしのruntimeへ
execution bundleを渡す。科学runtimeはNeonへ接続しない。

```text
Web
→ FastAPI
→ repository layer
→ Neon
→ durable job
→ Worker
→ isolated VQE runtime
→ result contract
→ repository layer
→ Neon
→ Web
```

## 7. VQE Component model

一つの「VQE algorithm」は、versioned componentを組み合わせたWorkflowと定義する。
MVP schemaは最低限、次のcomponent typeを区別する。

```text
problem
problem_preparation
representation
reference_state
ansatz
operator_pool
search_selection
growth_batching
parameter_optimizer
compression
measurement
error_mitigation
compilation_backend
learning_training
evaluation_protocol
workflow
```

Componentはstring labelではなく、既存`Artifact` / immutable `ArtifactVersion`を
identityとして再利用する。例えば`ansatz="uccsd"`だけでなく、
`ansatz_artifact_version_id`でversion、source、license、evidenceへ到達できるようにする。

## 8. MVP DB responsibilities

table数の少なさを目標にしない。既存tableとの重複を避けつつ、検索・比較に必要な
relationをJSONBだけへ隠さない。最終table構成はPhase 2 corpusで検証後にADRで固定する。

### `vqe_component_specs`

既存ArtifactVersionへtyped component metadataを付与する。

```text
artifact_version_id PRIMARY KEY
schema_version
component_type
spec_json
normalized_spec_sha256
annotation_state
created_at
```

### `vqe_workflow_components`

Workflow ArtifactVersionとcomponent ArtifactVersionを結ぶ。

```text
workflow_artifact_version_id
component_role
component_artifact_version_id
ordinal
binding_metadata
created_at
```

### `vqe_experiments`

immutable scientific specのみを保持する。実行statusは既存`runs` / `jobs`がauthority。

```text
id
run_id UNIQUE
workspace_id
user_id
schema_version
workflow_artifact_version_id
scientific_spec_json
scientific_spec_sha256
protocol_version
created_at
```

`status`、framework、runtime profileをここへ重複保存しない。

### `vqe_observations`

append-only execution evidence。

```text
id
experiment_id
attempt
framework
provider_versions
runtime_profile_id
runtime_image_digest
adapter_release_id
architecture
dataset_snapshot_id
protocol_version
scientific_spec_sha256
hamiltonian_digest
status
summary_json
detail_object_uri
detail_sha256
detail_size_bytes
evidence_json
failure_code
created_at
```

制約:

- repository functionsは`Scope`を第一引数とする。
- workspace/userはrequest bodyから信用しない。
- execution statusは`runs` / `jobs`をauthorityとする。
- observationをUPDATEして結果を書き換えない。
- retryは新しいattemptを追加する。
- component correctionは新しいArtifactVersionを作る。
- public Artifact化は成功後の明示処理。
- trajectory/detailが上限を超える場合、Neonにはsummary、object URI、hash、size、
  schema versionだけを保存する。
- migrationは実装開始時の実headから採番する。`0035`を本文だけで予約しない。

## 9. Scientific specとExecution bindingの分離

### `ScientificExperimentSpec v0.1`

「何を科学的に計算するか」を表し、framework/runtimeを含めない。

最低field:

```text
schema_version
problem_version_id
dataset_snapshot_id
representation_version_id
reference_state_version_id
ansatz_version_id
operator_pool_version_id
selection_version_id
growth_version_id
optimizer_version_id
compression_version_id
measurement_protocol_version_id
evaluation_protocol_version_id
initial_parameters
seed
stopping_protocol_version_id
```

同じ科学実験をQiskit/PennyLaneで実行するとき、
`scientific_spec_sha256`は同一でなければならない。

### `ExecutionRequest`

userが指定できるのはcapabilityと、UIで許可されたframework preferenceまで。

```text
experiment_id
requested_capability
preferred_framework
```

### `ExecutionBinding`

APIがsupport matrixから解決したauthority。

```text
framework
provider_versions
runtime_profile_id
adapter_release_id
container_digest
architecture
dataset_snapshot_id
protocol_version
```

user supplied `problem_digest` / `hamiltonian_digest`をauthorityにしない。APIは
versioned Problem/Componentからexpected digestを解決し、runtime観測値と照合する。
任意Python code、module名、filesystem pathは全contractで禁止する。

### Idempotency identity

最低限、次を含むserver-generated identityとする。

```text
scientific_spec_sha256
runtime_profile_id
adapter_release_id
dataset_snapshot_id
protocol_version
```

## 10. Version model

MVPから次のidentityを混同しない。

1. Scientific method version
2. Component ArtifactVersion
3. Source revision / commit SHA
4. Provider release
5. Adapter release
6. Runtime profile / image digest / lock digest
7. Dataset/problem snapshot
8. Evaluation/stopping/resource protocol version

### Version lanes

```text
frozen_reproduction
  paper/reviewed Artifact時点のsourceとenvironment

current_compatibility
  Atlasが現在supportするprovider/runtime
```

`latest_observed`は後続GitHub Wrapperで追加し、verifiedを自動付与しない。

## 11. Result contract

最低field:

```text
scientific_spec_sha256
framework
provider_versions
runtime_profile_id
runtime_image_digest
adapter_release_id
dataset_snapshot_id
protocol_version
hamiltonian_digest
status
best_energy_ha
exact_energy_ha
absolute_error_ha
iterations
converged
seed
parameter_count
qubits
depth
gate_count
two_qubit_gate_count
metric_stage
logical_or_compiled
basis_gates
compiler
compiler_version
optimization_level
layout
routing
compiler_seed
wall_time_ms
energy_trajectory
warnings
failure_code
```

raw runtime stdoutをresult contractとして保存しない。stdout/stderrはbounded log
として別扱いにし、秘密値scanを通す。`energy_trajectory`はMVPのbounded summary
までとし、上限超過時はcontent-addressed objectへ保存する。

---

# Part III. Scientific correctness

## 12. Golden fixture

最初のfixtureはH2/STO-3Gの小規模問題だけに固定する。

保存物:

```text
fixture manifest
geometry/convention
nuclear repulsion
electron/orbital/qubit counts
canonical Pauli terms
coefficient dtype/precision
Hamiltonian digest
Hartree-Fock bitstring/wire order
exact diagonalization result
approved ansatz definition
approved initial point
expected parameter count
acceptance tolerance
fixture generator version
review record
```

golden energyはこの計画書に手入力しない。独立exact calculation、cross-provider
comparison、人間reviewを通したfixture fileだけをauthorityとする。

## 13. MVP numerical gates

exact estimator:

- input Hamiltonian digestがfixtureと一致。
- Qiskit/PennyLaneのcanonical Hamiltonianが一致、または明示的なpermutation
  equivalenceを証明。
- 最終energyの絶対誤差がapproved fixture tolerance以内。
- 同じseed/spec/profileで許容範囲内に再現。
- parameter countとqubit countが期待値に一致。

初期目標tolerance候補:

```text
exact diagonalization cross-check: <= 1e-10 Ha
VQE accepted result: <= 1e-5 Ha
```

これらはfixture実測後にprotocol fileで確定し、テストを緩める変更はreview対象。

finite shotsはMVP UIで無効または`experimental`表示とし、MVP合格条件にしない。

## 14. Cross-framework comparison

比較は次を固定してから行う。

```text
problem_digest
Hamiltonian digest/equivalence
mapping
qubit/wire order
reference state
ansatz semantic definition
initial point
optimizer configuration
seed
estimator
stopping rule
metric stage
```

出力:

```text
strict
controlled
partial
invalid
```

unknown fieldがある場合は`strict`にしない。

---

# Part IV. Phased implementation

## Phase 0 — Plan freeze and executable spike

**Status:** complete (owner-approved 2026-07-24; see
`docs/atlas/PHASE0_OWNER_REVIEW.md` for the review bundle, corrections made
before approval, and what remains open but non-blocking: ADR text formally
flipped to `accepted`, deeper domain-scientist review of the H2 fixture)  
**DB change:** none  
**Network:** none  
**UI:** none

### Goal

DB/API/UIを変更する前に、共通specと2 frameworkでH2を再現できることを証明する。

### Slices

#### 0A. ADR

追加候補:

```text
docs/adr/<next>-vqe-experiment-identity.md
docs/adr/<next>-vqe-runtime-profiles.md
docs/adr/<next>-vqe-scientific-evidence.md
```

決定:

- ExperimentとArtifactの関係
- Component/WorkflowとArtifactVersionの関係
- ScientificExperimentSpecとExecutionBindingの分離
- frozen/current version lane
- runtime/profileのtrust boundary
- canonical Hamiltonian
- exact/finite-shot evidenceの違い
- retryとappend-only observation

#### 0B. Local spike

tracked product codeへ入れる前に、fixture/test harnessで以下を確認する。

- candidate Qiskit dependency lock
- candidate PennyLane dependency lock
- wheel availability
- H2 exact energy
- canonical Hamiltonian
- parameter/wire convention
- execution time/memory

### Acceptance

- 両runtimeが独立lockで構築できる。
- H2 canonical digestが一致またはpermutation equivalence。
- exact resultがapproved tolerance内。
- failureを正しくnon-zero exitとJSON failure contractで返す。
- 実測結果を記録し、推測値を書かない。

### Result (2026-07-24, arm64 macOS, `uv run` isolated candidates)

実測値。全て `docs/atlas/fixtures/h2_sto3g/` の生成物 (manifest.json 及び raw/*.json) から。

- 独立FCI基準 (PySCF, qubit mapping不使用): -1.1373060357534004 Ha。
- Qiskit-current (qiskit 1.4.6 / qiskit-nature 0.8.0 / pyscf 2.14.0):
  qubit Hamiltonian厳密対角化 -1.137306035753399 Ha (FCI比誤差 1.3e-15 Ha)。
- PennyLane-current (pennylane 0.45.1 / pyscf 2.14.0):
  qubit Hamiltonian厳密対角化 -1.1373060357532858 Ha (FCI比誤差 1.1e-13 Ha)。
- 両candidateのcanonical HamiltonianはNOT byte-identical (PennyLaneはnuclear
  repulsionをidentity項に含める、spin-orbital→qubit割当がblock対PennyLaneの
  interleavedで異なる、2 qubit分でJordan-Wigner位相規約が異なる)。二つの主張を
  混同しない: (1) 構造的対応 — qubit permutation `[0,2,1,3]` + per-qubit local
  Pauli-frame `[id,id,s,sdag]` による厳密・離散的な対応 (網羅的探索で発見、
  文献からの推測ではない)。(2) 数値的一致 — 対応適用後の係数差は最大
  6.52e-10 Ha、独立した16固有値スペクトル全体差は1.20e-9 Ha
  (PySCFのconv_tol=1e-9 Ha default、インストール済みpackageから直接確認、を
  出典とする2回の独立SCF収束に整合)。これは「同一物理演算子であるという証拠」
  であり「byte-exactに同一である証明」ではない — 2回の独立浮動小数点SCF計算が
  machine precisionまで一致することはない。
- 失敗時JSON contract (`status: execution_failed`, non-zero exit) を実際に
  invalid basisで発火させ動作確認済み。当初は一回限りの手動sed編集で検証したが、
  owner reviewの指摘を受けて`spike/test_failure_contract.py`という再実行可能な
  pytestへ格上げ済み (両runtimeでpytest実行、2 passed)。

詳細・再現手順は `docs/atlas/fixtures/h2_sto3g/README.md`。owner-approved review
bundleは `docs/atlas/PHASE0_OWNER_REVIEW.md` (2026-07-24)。

### Rollback

docs、fixture、独立runtime candidateだけを削除可能。DB/API影響なし。

---

## Phase 1 — VQE Component and Scientific Schema

**Status:** complete (2026-07-24; `packages/py/vqe/`, 80 tests, no DB/UI touched)  
**DB change:** none  
**UI:** none

### Deliverables

- `ComponentSpec v0.1`
- `WorkflowSpec v0.1`
- `ScientificExperimentSpec v0.1`
- `ExecutionRequest` / `ExecutionBinding`
- `EvaluationProtocol v0.1`
- component version reference
- canonical Hamiltonian model
- digest/canonicalization
- result contract
- comparison dimension model
- capability allowlist
- H2 fixture loader

### Tests

- serialization round-trip
- key-order-independent digest
- coefficient normalization
- qubit permutation fixture
- invalid/unknown field rejection
- arbitrary path/module/code rejection
- Qiskit/PennyLane fixture parity
- scientific spec hash unchanged across framework bindings
- component ArtifactVersion reference validation

### Acceptance

Framework packageなしで全core testが通り、少なくとも5件の実論文annotationを
lossなく表現できる。

### Result (2026-07-24)

- `packages/py/vqe/src/majorana_vqe/`: `models.py` (ComponentSpec/WorkflowSpec/
  ScientificExperimentSpec/ExecutionRequest/ExecutionBinding/ResultContract/
  capability allowlist/path-module-code rejection)、`canonical.py`
  (CanonicalHamiltonian/digest/idempotency key/H2 fixture loader)、
  `comparison.py` (comparison dimension model、classify_comparisonはMVP
  heuristicと明記)、`protocol.py` (EvaluationProtocol/StoppingProtocol)。
- `uv run pytest packages/py/vqe -q` → **80 passed**、`ruff check`/`format --check`
  → clean。実測: 実論文5本 (Peruzzo 2014 doi:10.1038/ncomms5213、
  O'Malley 2016 doi:10.1103/PhysRevX.6.031007、Kandala 2017
  doi:10.1038/nature23879、Grimsley 2019 (ADAPT-VQE)
  doi:10.1038/s41467-019-10988-2、Tang 2021 (Qubit-ADAPT-VQE)
  doi:10.1103/PRXQuantum.2.020310) をWebSearchで書誌情報を検証した上で
  ComponentSpecとしてannotationし、round-trip・classification distinctness
  をtest済み (`tests/test_five_papers_lossless.py`)。
- `[tool.importlinter]`に`majorana_vqe`のforbidden-import contractを追加し、
  qiskit/pennylane/fastapi/sqlalchemy/majorana_api/majorana_workerの
  import不能を自動enforce (`uv run lint-imports` → 4 kept, 0 broken)。
- 実装中に発見した不具合1件: path/module/code拒否のsafe-labelパターンが
  DOI (`10.1038/ncomms5213`)や実論文のdescription (セミコロン含む) を
  誤って拒否していた。allowlistを`/`と一般的な文章記号
  (`;:'?!"`)へ拡張し、path traversal/絶対pathの拒否は別の、より特異的な
  patternが引き続き担当することを確認した上で修正 (regression test追加)。
- 未解決の設計上の疑問 (silently resolvedにしない): `stopping_protocol_version_id`
  に対応する`ComponentType`がplanの16種リストに存在しない
  (`protocol.py`のコメント参照) — Phase 3でのrepository実装前にowner/ADR
  判断が必要。
- `uv run pytest` (repo全体、DATABASE_URL未設定) → 967 passed, 0 failed,
  67 skipped (DB-gated tests) — 既存機能への影響なし確認済み。

---

## Phase 2 — Curated VQE Registry

**Status:** blocked_owner (corpus mechanics done 2026-07-24: 26 papers, 15
repositories, 59 components, all `annotation_state: draft`; stopped before
claiming human-reviewed%, inter-annotator agreement, or the 3 manual-gold
comparison reports — see `docs/atlas/PHASE2_PROGRESS.md`)  
**DB change:** none  
**UI:** none

### Goal

GitHub WrapperやDB schemaを先に作らず、実論文でcomponent ontologyとannotation
guidelineを検証する。

### Corpus targets

```text
VQE papers: >= 25
official/author implementation repositories: >= 15
component records: >= 50
human-reviewed records: >= 80%
curated comparison reports: >= 3
```

候補method family:

```text
VQE / UCCSD
ADAPT-VQE
Qubit-ADAPT
QEB-ADAPT
TETRIS-ADAPT
CEO-ADAPT
Param-ADAPT
pruning / compression
measurement reduction
learning-guided VQE
```

### Machine-readable corpus

保存対象:

- paper DOI/arXiv and bibliographic facts
- implementation relation
- immutable paper-associated commit when known
- license state
- environment completeness
- versioned components
- workflow composition
- evidence locators
- unknown / ambiguous / conflicting fields
- reviewer decision and annotation schema version
- negative result / missing implementation

著作権のあるREADME本文やsource codeをcorpusへ転載しない。

### Acceptance

- annotation guidelineがversioned。
- 25/15/50 targetを満たす。
- 80%以上が人間review済み。
- 同じ論文を別reviewerがannotationしたagreementを測定。
- schemaで表せないfieldと曖昧さを記録。
- 3組以上のcomparison reportを手動goldとして作る。

---

## Phase 3 — Neon Component Registry and Experiment Persistence

**Status:** not_started  
**DB change:** expected; responsibilities are fixed after Phase 2  
**UI:** API contract only

### API candidate

```text
GET  /v1/atlas/components
GET  /v1/atlas/components/{id}
GET  /v1/atlas/workflows
GET  /v1/atlas/workflows/{id}
GET  /v1/atlas/comparisons/{id}
GET  /v1/vqe/capabilities
POST /v1/vqe/experiments
GET  /v1/vqe/experiments/{id}
POST /v1/vqe/experiments/{id}/cancel
GET  /v1/vqe/experiments/{id}/events
POST /v1/vqe/experiments/{id}/materialize
```

### Rules

- `POST`はIdempotency-Key必須。
- APIがScopeからworkspace/userを決定。
- Registry importはexplicit、idempotent、reviewed corpus限定。
- APIはcomponent ArtifactVersionを解決してscientific specを構築。
- requested capabilityをapproved ExecutionBindingへserver-side解決。
- user supplied runtime/digestをauthorityにしない。
- Worker job payloadはexperiment IDとScope pointer中心。
- runtimeはDB credentialを持たない。
- materializeは成功済みobservationのみ。
- public publicationは行わない。

### Neon acceptance

- temporary Neon child branch。
- migration up。
- live authz matrix。
- curated corpus import count/reconciliation。
- component/workflow relation invariant。
- job retry/reclaim。
- observation append-only。
- downgrade。
- re-upgrade。
- row count/invariant確認。
- Main/production branchへ接続しない。

---

## Phase 4 — Atlas Browse and Compare UI

**Status:** not_started  
**Primary UI owner:** Claude Code / designated UI owner  
**Codex lane:** contracts、API evidence、test fixture、non-UI review

### UI placement

Registryと比較をMVPの主画面にする。既存`/repository`とのidentity/search重複を
ADRで解決し、Atlasが別の孤立Catalogにならないようにする。

最小情報architecture:

```text
Atlas
├── Methods / Workflows
├── Components
├── Problems
└── Comparisons
```

### Browse requirements

```text
method family
component type
problem/molecule
basis/mapping
ansatz/operator pool
optimizer/compression
measurement
evidence/review state
license/environment completeness
```

### Detail requirements

```text
paper and implementation relation
paper-associated commit
component graph
scientific conditions
known missing/conflicting fields
reproducibility evidence
version/source/license
```

### Compare requirements

```text
fixed dimensions
changed dimensions
unknown dimensions
blocking mismatches
strict / controlled / partial / invalid
metric definition differences
```

最初の3 comparisonはcurated gold reportでよい。自動判定を装ってはならない。

### UI acceptance

- 25 papers / 50 componentsをfilterできる。
- componentから関連Workflow/論文へ遷移できる。
- 3 comparison reportを表示できる。
- unknown/conflictを空欄に変換しない。
- clientへ全raw corpusを無制限送信しない。
- keyboard、responsive、dark/light、reduced motionを確認。
- loading、empty、failureをfixtureで確認。

---

## Phase 5 — Qiskit/PennyLane Proof Execution

**Status:** not_started  
**DB change:** Phase 3 tablesを利用  
**UI:** Studio / Run / Library integration

### 5A. Isolated runtimes

Qiskit/PennyLaneを別profileにし、候補versionはresolver、lock、golden test、
human promotion前は`CANDIDATE_UNVERIFIED`とする。

Runtime requirements:

- prebuilt digest-pinned image
- independent package lock and SBOM
- non-root / read-only root
- deny-all network
- no credentials / DB access / runtime install
- CPU/memory/pids/time/output cap
- immutable input / ephemeral output

### 5B. Studio proof flow

```text
curated H2 Workflowを開く
→ ScientificExperimentSpecを確認
→ preferred frameworkを選ぶ
→ APIがapproved ExecutionBindingを解決
→ durable run
→ result/evidenceを表示
→ Artifactへmaterialize
→ other framework observationと比較
```

Runtime profileをuserの自由文字列として選択させない。

### Execution acceptance

1. 同じscientific spec SHAでQiskit/PennyLaneを実行。
2. APIが201/idempotent response。
3. Workerがdurably処理。
4. Hamiltonian equivalenceとenergy gateがpass。
5. runtime/adapter/image/protocol identityを保存。
6. resource metric stage/compiler semanticsを保存。
7. retryは新observation。
8. service restart後も結果が残る。
9. Run/Library UIで証拠を再閲覧。
10. named failureをhonest terminal stateで表示。

---

## Phase 6 — MVP hardening and release decision

**Status:** not_started

### Required gates

- Python/TS lint、typecheck、tests
- generated contract drift
- curated corpus schema/reconciliation
- migration up/down/up
- authz and job retry/reclaim
- sandbox hostile and live egress gate
- repeated H2 golden runs
- cross-framework comparison
- Browse/Compare/Studio browser tests
- accessibility smoke
- resource/cost measurement
- rollback rehearsal
- threat and rights review

### MVP Go criteria

Registry:

- papers >= 25
- implementation repositories >= 15
- components >= 50
- human-reviewed >= 80%
- unknown/conflict表示

Compare:

- curated reports >= 3
- strict/controlled/partial/invalid表示
- component、dataset、optimizer、resource metric定義差を表示

Execution:

- 10 consecutive exact H2 runs per framework without infrastructure failure
- identical scientific spec SHA across framework bindings
- numerical/equivalence gates pass
- no network/credentials/DB in runtime
- failure/retry/rollback evidence

Academic:

- versioned schema and annotation guideline
- machine-readable curated corpus
- gold labels usable for later extraction/comparison evaluation
- negative/unknown evidence preserved

---

# Part V. Staged GitHub Wrapper

GitHub Wrapperはcurated RegistryのschemaとUIを実データで検証した後に追加する。
最初は手動URL入力のmetadata-only importであり、code executionを行わない。

## Phase 7 — Manual read-only GitHub metadata import

**Execution:** prohibited  
**Publication:** prohibited by default

### Initial input

```text
public GitHub repository URL
optional ref
optional DOI/arXiv
```

### Initial output

- numeric repository identity
- immutable commit SHA
- bounded file manifest
- license/citation/dependency facts
- selected VQE assertions
- unknown/conflicts
- extraction candidates

Phase 2 corpusをground truthにして、同じRepositoryの取得結果を照合する。

### Minimal provider permissions

```text
Metadata: read
Contents: read
```

private Repository、webhook、author claimは別phase。

## Phase 8 — Deterministic structured extraction

- CITATION.cff
- pyproject.toml
- requirements/lockfiles
- Dockerfile
- GitHub Actions
- Python AST
- sanitized notebook

deterministic baselineのprecision/recall/evidence locator accuracyを測定する。

## Phase 9 — LLM-assisted extraction and reviewed materialization

LLMはdeterministic baseline後にのみ追加する。

- no tools/network/secrets
- schema constrained
- evidence locator required
- source textはuntrusted data
- publish authorityなし
- model/prompt/schema version保存

一Repositoryから複数candidateを生成可能にする。

- implementation
- component
- problem
- dataset
- experiment

自動publishしない。人間review後にArtifactへmaterializeする。

## Phase 10 — External execution

MVPとは別のsecurity milestone。

開始条件:

- quarantine/object storage ADR
- fetcher credential separation
- source license decision
- prebuilt runtime mapping
- no dynamic install
- no network
- no credentials
- dedicated hostile corpus
- owner security approval

---

# Part VI. Neon version control

## 13. Branch model

```text
Neon main / production
  └── current development parent
        └── feature-vqe-dev
              └── feature-vqe-migration-<date>-<slice>
```

### Rules

- Main/productionへmigration testを行わない。
- Feature DBはMainへのwrite-backを持たない。
- migrationごとにdisposable childを作る。
- schema-only branchはmigration単体testに使用可能。
- UI/E2Eで既存fixtureが必要ならData + schema branchを使う。
- 個人/本番データを複製する場合はPIIとretentionを確認する。
- disposable branchにはauto-deleteを設定する。
- persistent feature branchを1日でauto-deleteしない。

## 14. Connection split

```text
DATABASE_URL
  Neon pooled endpoint
  API / Worker / live tests

DATABASE_URL_DIRECT
  Neon direct endpoint
  Alembic / approved admin operation only
```

- `.env.local`だけに保存。
- file permission `600`。
- Git、chat、screenshots、logsへ出さない。
- Main credentialをfeature branchへ流用しない。
- 露出時はpassword rotation。
- API/Worker再起動で新URLを反映。

## 15. Migration protocol

1. Workerを停止。
2. current `origin/dev`とmigration headを確認。
3. disposable Neon childを作る。
4. direct URLで`upgrade head`。
5. pooled URLでapplication/live tests。
6. invariantとrow countを記録。
7. `downgrade <previous>`。
8. 再度`upgrade head`。
9. application/live testsを再実行。
10. rollback手順を記録。
11. unexpected count/identity/schemaで停止。
12. production promotionは別owner action。

Migrationへ283 CatalogのseedやVQE fixtureを黙って入れない。fixture/bootstrapは
明示的、idempotent、監査可能なcommandにする。

## 16. Neon evidence record

各DB sliceで記録する。

```text
Neon branch name
parent branch
schema-only or data+schema
expiry
starting Alembic revision
ending revision
up/down/up result
test commands and real counts
row counts before/after
rollback result
Main untouched confirmation
```

connection stringやpasswordは記録しない。

---

# Part VII. Git and GitHub version control

## 17. Branch model

```text
origin/dev
  └── feature/vqe
        ├── small logical commits
        └── optional short-lived feature/vqe-<slice> branches if parallel work is needed
```

### Fixed rules

- `dev`へ直接commit/pushしない。
- `feature/vqe`をVQE統合branchとする。
- 実装開始前に`git fetch origin dev`。
- `dev...origin/dev`と`feature/vqe...origin/dev`のahead/behindを確認。
- conflict areaを作業前に列挙。
- force push、rebase、history rewriteはowner承認なしで行わない。
- mergeはClaude/owner review後。
- production/publicationは別承認。

## 18. Commit policy

一commit一論理変更。

```text
docs: freeze VQE MVP architecture
add: define VQE experiment contracts
add: canonicalize VQE Hamiltonians
add: execute H2 in the Qiskit profile
add: execute H2 in the PennyLane profile
add: persist VQE experiments safely
add: expose VQE experiment API
add: render VQE results in Studio
```

generated fileとsource changeを同commitに含める場合、その生成commandを記録する。

## 19. Push policy

- この初期plan commitはownerの明示依頼により`feature/vqe`へPushする。
- 以後のPushは依頼/合意されたslice単位。
- Push前にstatus、diff、tests、secret scanを確認。
- Pushはmergeではない。
- PR作成はownerが依頼した場合、またはmerge準備に入った場合のみ。

## 20. Conflict prevention

特に競合しやすい領域:

```text
services/api/src/majorana_api/orm.py
packages/py/contracts/
packages/py/contracts/openapi.json
apps/web/app/(app)/studio/
apps/web/lib/circuit-conversion.ts
services/worker/src/majorana_worker/handlers.py
db/migrations/
uv.lock
pnpm-lock.yaml
```

対策:

- slice開始時にownerを一人決める。
- schema/contracts/UIを同時に別agentが編集しない。
- generated contractはAPI contract確定後に一度生成。
- migrationは単一線形headを維持。
- unrelated formattingをしない。
- lockfile変更は依存変更sliceだけ。

---

# Part VIII. Codex / Claude Code collaboration

## 21. Default lanes

### Codex

- plan pressure test
- pure VQE model/canonicalization
- Qiskit/PennyLane adapter contracts
- golden/scientific tests
- verification/comparison
- non-UI API/repository review
- sandbox/security review
- Python test coverage

### Claude Code

- cross-package integration
- DB migration orchestration
- API/Worker wiring
- generated contract coordination
- UI implementation
- branch integration/review
- merge preparation

### Human owner

- scientific ambiguity decision
- UX/product priority
- license decision
- credential action
- paid execution
- public deployment
- Main/production migration
- merge approval

Agent能力ではなく、同時編集とblast radiusを減らすための既定laneである。

## 22. Slice handoff template

各agentは終了時に次を残す。

```markdown
## VQE handoff

- Date:
- Agent:
- Branch / commit:
- Phase / slice:
- Status:
- Goal completed:
- Files changed:
- Contracts changed:
- Migration revision / Neon branch:
- Tests actually run:
- Tests not run and why:
- Scientific evidence produced:
- Security impact:
- Known failures:
- Conflict areas:
- Owner decisions required:
- Exact next action:
```

## 23. Agent start checklist

1. Root/nested `AGENTS.md`を読む。
2. `docs/atlas/README.md`を読む。
3. このMVP planの対象phaseだけ読む。
4. current branch/commit/status確認。
5. `origin/dev`との差確認。
6. migration head確認。
7. target filesとblast radius確認。
8. 前agentのhandoff確認。
9. acceptance gateを先にtestへ落とす。
10. scope外変更をしない。

## 24. Stop conditions

以下はowner decisionまで停止する。

- Main/production Neonへの操作が必要
- credential作成・rotation・表示
- 有料QPU/GPU/大量LLM call
- network-enabled untrusted execution
- destructive migration
- scientific conventionが結果を変える曖昧さ
- license conflict
- public publication
- runtimeがunreviewed native source buildを必要とする
- deny-all egressを保証できない
- current `dev`との重大conflict

---

# Part IX. Test matrix and Definition of Done

## 25. Required commands by surface

Python:

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

TypeScript:

```bash
pnpm turbo run lint typecheck test
```

Focused VQE candidates:

```bash
uv run pytest packages/py/vqe -q
uv run pytest services/api/tests -q
uv run pytest services/worker/tests -q
```

Runtime profile:

```bash
uv lock
uv sync --frozen
uv run --frozen python -m profile_tests.import_conformance
uv run --frozen python -m profile_tests.scientific_golden
uv export --frozen --format pylock.toml --output-file pylock.toml
uv export --frozen --format cyclonedx1.5 --output-file sbom.cdx.json
```

CycloneDX exportは利用uv versionでpreview状態を再確認し、生成物をsecurity
authorityそのものとはみなさない。

## 26. MVP Definition of Done

MVPは以下が全部成立したときだけcomplete。

- Component/Workflow/Scientific Experiment schema v0.1がversioned。
- Scientific specとExecutionBindingが分離。
- 25 papers / 15 repositories / 50 componentsを収録。
- 80%以上のrecordが人間review済み。
- 3組以上のcurated comparison report。
- unknown/conflict/negative evidenceを表示。
- Atlas Browse / Compare UIが利用可能。
- H2 fixtureがreview済み。
- Qiskit profileがdigest-pinned。
- PennyLane profileがdigest-pinned。
- 両frameworkでscientific spec SHAが同一。
- 両frameworkのnumerical gateがpass。
- canonical comparisonがpass。
- API creationがidempotent。
- authz matrixがpass。
- job crash/retry/reclaimがpass。
- observationがappend-only。
- Neon migration up/down/upがpass。
- runtime egressがfail-closed。
- UIから作成・実行・閲覧・保存可能。
- empty/loading/failure/cancelled UIが確認済み。
- Artifact exportにVQE evidenceが含まれる。
- schema、annotation guideline、curated corpusがmachine-readable。
- rollback手順を実行済み。
- 実際に行っていないtest/resultを記載していない。
- ownerがMVP user flowを確認。

---

# Part X. Immediate execution order

順序:

1. 改定planを`feature/vqe`へ保存・Push。
2. owner/Claude/CodexでPhase 0 ADR boundaryをreview。
3. H2 golden fixtureとQiskit/PennyLane resolver spike。
4. Component/Workflow/Scientific Experiment schema。
5. 5論文pilot annotation。
6. schema修正後、25 papers / 15 repositories / 50 componentsへ拡張。
7. 3 curated comparison reports。
8. Neon Component Registryとexplicit corpus import。
9. Atlas Browse / Compare UI。
10. Qiskit/PennyLane isolated runtimes。
11. durable API / Studio proof execution / Artifact化。
12. MVP hardeningとGo/No-Go。
13. manual GitHub metadata import。
14. deterministic extraction。
15. LLM-assisted extraction/review。

最初の実装commitはDB migrationではなく、Phase 0のADRとscientific spikeにする。

---

# Final safety invariants

1. Main/production Neonへfeature testを書き込まない。
2. DB accessはrepository layer以外へ増やさない。
3. untrusted executionは常にdeny-all egress。
4. runtimeへcredentialを渡さない。
5. 実行時package installをしない。
6. support claimはversion/profile/capability/evidenceへ紐づける。
7. Qiskit/PennyLaneで科学条件を揃えてから比較する。
8. exact、finite-shot、QPU evidenceを混同しない。
9. failureとunknownを隠さない。
10. Registryはversioned Artifact componentをidentityにする。
11. 外部Repository code executionをMVPへ入れない。
12. GitHub Wrapperはmetadata-onlyから開始する。
13. scientific specとexecution bindingを混同しない。
14. 登録件数だけでなく研究者の検索・比較時間短縮を測る。

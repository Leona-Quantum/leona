# Atlas VQE MVP 実行計画

**文書version:** 1.0  
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

MVPの優先順位は次のとおり。

```text
VQEの共通科学仕様
→ Qiskit/PennyLaneで確実に実行
→ 同じ条件で結果を比較
→ UIから作成・実行・閲覧
→ Artifactとして保存・再利用
→ GitHub Wrapperをmetadata-onlyで追加
→ 外部Repository実行は十分な隔離後
```

この順序を変更して、最初から大量のGitHub Repository取得、巨大ontology、
GPU、QPU、古い論文環境の実行へ進んではならない。

## Phase overview

| Phase | Outcome | DB | UI | Current status |
|---|---|---:|---:|---|
| 0 | ADR + H2/Qiskit/PennyLane executable spike | no | no | next |
| 1 | Pure VQE spec、canonical Hamiltonian、result contract | no | no | not_started |
| 2 | Two isolated, locked, deny-network runtimes | no | no | not_started |
| 3 | Durable API、job、Neon persistence | yes | contract only | not_started |
| 4 | Studio→Run→Artifact user flow | existing APIs + Phase 3 | yes | not_started |
| 5 | Security/scientific/E2E hardening and MVP Go/No-Go | test only | test | not_started |
| 6 | GitHub metadata-only wrapper | later | minimal | later |
| 7–8 | Deterministic extraction and reviewed materialization | later | later | later |
| 9 | Isolated external Repository execution | separate milestone | later | prohibited in MVP |

**Active pickup:** Phase 0A ADR boundary、続いてPhase 0B scientific spike。  
一つのphaseのacceptanceを満たす前に次phaseのproduction wiringへ進まない。

---

# Part I. Fixed decisions

## 1. MVPの一文

> 研究者がH2の小規模VQE実験を、同一のversioned ExperimentSpecから
> QiskitまたはPennyLaneで実行し、energy・exact referenceとの差・
> circuit resources・runtime evidenceをUIで確認し、再利用可能なArtifact
> として保存できる。

## 2. MVPで必ず実現するもの

1. Framework非依存の`VQEExperimentSpec v0.1`。
2. Canonical Hamiltonian表現とdigest。
3. Qiskit CPU runtime profile。
4. PennyLane CPU runtime profile。
5. H2の独立承認済みgolden fixture。
6. exact/statevector execution。
7. deterministic seed、固定initial point、固定tolerance。
8. 実行結果、resource metrics、environment digestの永続化。
9. APIからのidempotentな実験作成。
10. durable jobによる実行と再起動後の継続。
11. Studio UIからの作成・実行。
12. Run detail UIでの結果・失敗理由表示。
13. Library/Artifact detailでのVQE metadata表示。
14. Qiskit/PennyLane間の比較report。
15. deny-all network、credentialなし、resource cap付きruntime。

## 3. MVPに含めないもの

- 任意GitHub Repository codeの実行
- GitHub App installation
- 自動論文検索
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

```text
Studioを開く
→ VQE modeを選ぶ
→ Problem: H2 / approved fixtureを選ぶ
→ Framework: QiskitまたはPennyLaneを選ぶ
→ exact executionを選ぶ
→ seed/optimizer budgetを確認する
→ 実行する
→ energy trajectoryと最終energyを見る
→ exact referenceとの差を見る
→ qubits/depth/gates/parameters/runtimeを見る
→ environment/profile/evidenceを見る
→ Artifactとして保存する
→ 他frameworkの同条件結果と比較する
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

APIはspecを検証・保存・enqueueする。Workerはprofileを選び、credentialなしの
runtimeへ実行bundleを渡す。科学runtimeはNeonへ接続しない。

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

## 7. 最小DB extension

MVPでは2 tableを上限候補とする。実装時ADRで、既存tableだけで安全に表現
できるならさらに減らす。

### `vqe_experiments`

```text
id
run_id UNIQUE
workspace_id
user_id
schema_version
spec_json
spec_sha256
runtime_profile_key
status
created_at
updated_at
```

### `vqe_observations`

append-only:

```text
id
experiment_id
attempt
framework
runtime_profile_key
runtime_image_digest
adapter_version
input_spec_sha256
hamiltonian_digest
status
result_json
evidence_json
failure_code
created_at
```

制約:

- repository functionsは`Scope`を第一引数とする。
- workspace/userはrequest bodyから信用しない。
- observationをUPDATEして結果を書き換えない。
- retryは新しいattemptを追加する。
- public Artifact化は成功後の明示処理。
- migrationは実装開始時の実headから採番する。`0035`を本文だけで予約しない。

## 8. `VQEExperimentSpec v0.1`

最低field:

```text
schema_version
problem_fixture_id
problem_digest
hamiltonian_digest
framework
runtime_profile_key
mapping
qubit_order
reference_state
ansatz
ansatz_options
optimizer
optimizer_options
initial_point
seed
estimator
shots
max_iterations
energy_tolerance_ha
resource_limits
```

MVPで許可する値はclosed allowlistとする。

```text
problem_fixture_id: h2-sto3g-v1
framework: qiskit | pennylane
mapping: jordan_wigner
reference_state: hartree_fock
ansatz: approved_ucc_style_fixture_v1
estimator: exact
shots: null
```

任意Python code、任意module名、任意filesystem pathをspecに入れない。

## 9. Result contract

最低field:

```text
spec_sha256
framework
runtime_profile_key
runtime_image_digest
adapter_version
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
wall_time_ms
energy_trajectory
warnings
failure_code
```

raw runtime stdoutをresult contractとして保存しない。stdout/stderrはbounded log
として別扱いにし、秘密値scanを通す。

---

# Part III. Scientific correctness

## 10. Golden fixture

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

## 11. MVP numerical gates

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

## 12. Cross-framework comparison

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

**Status:** not_started  
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

### Rollback

docs、fixture、独立runtime candidateだけを削除可能。DB/API影響なし。

---

## Phase 1 — Pure VQE core

**Status:** not_started  
**DB change:** none  
**UI:** none

### Deliverables

- `VQEExperimentSpec v0.1`
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

### Acceptance

Framework packageなしで全core testが通る。

---

## Phase 2 — Isolated Qiskit and PennyLane runtimes

**Status:** not_started  
**DB change:** none  
**UI:** none

### 2A. Qiskit candidate

候補versionはマスタープラン記載値からresolverで再確認し、lock/test前は
`CANDIDATE_UNVERIFIED`とする。

最初のcapability:

```text
h2-sto3g-v1
jordan_wigner
approved ansatz v1
exact estimator
deterministic optimizer configuration
resource observation
```

### 2B. PennyLane candidate

同じExperimentSpecとResult contractを使用する。

### Runtime requirements

- prebuilt image
- base image digest pin
- package lock
- SBOM
- non-root
- read-only root
- deny-all network
- no credentials
- no package install at execution
- CPU/memory/pids/time/output cap
- immutable input
- ephemeral output

### Acceptance

- Tier A: build/import/SBOM/security scan
- Tier B: H2 scientific golden
- egress canary fails to connect
- filesystem escape test fails
- timeout/OOM/output cap are named failures
- runtime image digestがresultに残る

---

## Phase 3 — Durable API and Neon persistence

**Status:** not_started  
**DB change:** expected, maximum two new tables  
**UI:** API contract only

### API candidate

```text
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
- APIはclosed allowlistでspecを検証。
- Worker job payloadはexperiment IDとScope pointer中心。
- runtimeはDB credentialを持たない。
- materializeは成功済みobservationのみ。
- public publicationは行わない。

### Neon acceptance

- temporary Neon child branch。
- migration up。
- live authz matrix。
- job retry/reclaim。
- observation append-only。
- downgrade。
- re-upgrade。
- row count/invariant確認。
- Main/production branchへ接続しない。

---

## Phase 4 — Usable UI MVP

**Status:** not_started  
**Primary UI owner:** Claude Code / designated UI owner  
**Codex lane:** contracts、API evidence、test fixture、non-UI review

### UI placement

最初から新しい巨大Atlas navigationを作らない。

1. `/studio`へ`VQE` modeを追加。
2. 既存Run detailへVQE result panelを追加。
3. 既存Library artifact detailへVQE metadata panelを追加。
4. 需要確認後に専用`/atlas` navigationを検討。

### Studio fields

```text
Problem
Framework
Estimator
Seed
Iteration budget
Runtime profile
Capability/limitations
Expected cost: local CPU / no QPU charge
```

MVPではadvanced fieldを自由入力にしない。

### Result panel

```text
status
best energy
exact reference
absolute error
convergence
energy trajectory
framework/profile
Hamiltonian digest
qubits/depth/gates/parameters
wall time
evidence level
warnings/failure reason
```

### UI safety and UX

- unsupported optionを選択不能にする。
- failureを成功badgeへ変換しない。
- exact resultとfinite-shot resultを混同しない。
- runtime/profile/versionを折りたたみで確認可能にする。
- keyboard、responsive、dark/light、reduced motionを確認。
- loading、empty、failure、cancelledをfixtureで確認。

### MVP end-to-end acceptance

1. Local userがStudioからH2/Qiskitを作成。
2. APIが201を返す。
3. Workerがdurably処理。
4. exact resultがpass。
5. UIが結果を表示。
6. Artifactへmaterialize。
7. Libraryで再閲覧。
8. PennyLaneで同じ操作。
9. comparisonがstrictまたはcontrolledを根拠付き表示。
10. service restart後も結果が残る。

---

## Phase 5 — MVP hardening and release decision

**Status:** not_started

### Required gates

- Python lint/typecheck/tests
- TS lint/typecheck/tests
- generated contract drift check
- migration up/down/up
- authz tests
- sandbox hostile tests
- egress live gate on approved provider
- H2 repeated golden runs
- Qiskit/PennyLane comparison
- UI browser test
- accessibility smoke
- resource/cost measurement
- rollback rehearsal
- threat review

### MVP Go criteria

- 10 consecutive exact H2 runs per framework without infrastructure failure。
- 100% spec/result contract validation。
- numerical gate pass。
- no network egress。
- no credentials in runtime。
- no DB access outside repository layer。
- failed run leaves honest terminal state。
- p95 local H2 completion targetを実測し、目標値を設定。
- user can complete create→run→inspect→save without shell。

---

# Part V. Staged GitHub Wrapper

GitHub WrapperはVQE UI MVP完了後に追加する。ただし設計spikeは並行してよい。

## Phase 6 — Read-only metadata wrapper

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

### Start with 20 repositories

DB schemaを増やす前に、20件をfixture corpusとしてread-only取得・annotationする。

### Minimal provider permissions

```text
Metadata: read
Contents: read
```

private Repository、webhook、author claimは別phase。

## Phase 7 — Deterministic structured extraction

- CITATION.cff
- pyproject.toml
- requirements/lockfiles
- Dockerfile
- GitHub Actions
- Python AST
- sanitized notebook

LLM extractionはdeterministic baselineのprecision/recall測定後。

## Phase 8 — Reviewed materialization

一Repositoryから複数candidateを生成可能にする。

- method
- implementation
- component
- problem
- dataset
- experiment

自動publishしない。人間review後にArtifactへmaterializeする。

## Phase 9 — External execution

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

- VQE spec v0.1がversioned。
- H2 fixtureがreview済み。
- Qiskit profileがdigest-pinned。
- PennyLane profileがdigest-pinned。
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
- rollback手順を実行済み。
- 実際に行っていないtest/resultを記載していない。
- ownerがMVP user flowを確認。

---

# Part X. Immediate execution order

順序:

1. このplanを`feature/vqe`へ保存・Push。
2. owner/Claude/CodexでPhase 0 ADR boundaryをreview。
3. H2 golden fixture spike。
4. Qiskit/PennyLane isolated resolver spike。
5. pure VQE core。
6. isolated runtimes。
7. DB/API persistence。
8. Studio UI。
9. end-to-end hardening。
10. MVP Go/No-Go。
11. 20 Repository GitHub metadata spike。
12. deterministic GitHub Wrapper。

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
10. GitHub Wrapperはmetadata-onlyから開始する。
11. 外部Repository code executionをMVPへ入れない。
12. 登録件数より研究者の時間短縮を優先する。

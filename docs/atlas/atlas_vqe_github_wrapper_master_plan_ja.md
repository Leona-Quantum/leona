# Atlas GitHub Wrapper × VQE Framework Integration
# 超包括的分析・実装マスタープラン

**文書バージョン:** 1.0  
**調査基準日:** 2026-07-24 JST  
**対象Repository:** `EshMis/majorana`  
**分析基準commit:** `4ade53faf37443c90980f7515bbbb83b836240db`  
**文書の用途:** 人間の設計レビュー、AI coding agentによる段階実装、研究者向けプロダクト検証、学術研究計画  
**重要:** 本文中の外部package versionは、調査基準日に公式documentation・PyPIで確認した「候補」であり、Majoranaが対応を保証したversionではない。対応保証は、lock解決、container build、conformance test、scientific golden test、人間reviewの完了後にのみ付与する。

---

## 0. この文書が統合する二つの構想

本計画は、次の二つの構想を一つに統合する。

### 構想A: GitHub Wrapperを入口にする

```text
GitHub Repository
→ immutable snapshot
→ 根拠付きmetadata
→ VQE component
→ 比較可能性
→ 再現証拠
```

目的は、最新論文のRepositoryを低コストで発見・取得・分類し、研究者の手入力負担を減らすことである。

### 構想B: VQE frameworkを段階導入する

```text
広いIndex coverage
+
限定されたStructured coverage
+
狭く深いExecution coverage
```

目的は、多数のVQE ecosystemを検索可能にしつつ、実行保証を最初から無制限に広げないことである。

### 統合後の一文

> Atlasは、GitHubや論文を集めるリンク集ではなく、異種VQE実装を固定source・固定environment・根拠付きmetadata・比較可能性・再現証拠へ変換する研究基盤である。

---

# Part I. 最終判断

## 1. 採用する戦略

次を採用する。

1. GitHub Wrapperは最初から作る。
2. 全候補libraryを最初から「登録・索引対象」にはする。
3. 全候補libraryを最初からMajoranaの必須dependencyにはしない。
4. 初期のnative executionはQiskit系とPennyLane系へ限定する。
5. OpenFermionとPySCFは、実行frameworkではなくproblem/operator/chemistry providerとして扱う。
6. HamLibとPennyLane Datasetsはdataset providerとして扱う。
7. QuantMarkはbenchmark protocol・metric referenceとして扱い、production dependencyにしない。
8. Tangelo、OpenVQE、CUDA-QXは初期にはmetadata-onlyまたはstructured-onlyとし、専用runtimeで段階的に実行対応する。
9. 古い論文再現環境と最新版互換環境を絶対に同一化しない。
10. 「Framework対応」ではなく、`package × version × capability × runtime × evidence`で対応状態を宣言する。

## 2. 採用しない戦略

次は禁止する。

- API/Workerの共通imageへQiskit Nature、PennyLane qchem、Tangelo、OpenVQE、CUDA-QXを全部追加する。
- 一つの万能VQE containerを作る。
- 実行時に`pip install`する。
- branch名、tag名、`latest`をsource identityとして保存する。
- LLM抽出結果を直接公開metadataへ書く。
- READMEのclaimをverification evidenceとして扱う。
- Repository一件をArtifact一件とみなす。
- packageがrequirementsにあるだけで「利用済み」と断定する。
- 古い再現環境を最新版へ上書きする。
- `Executable`と`Paper Claim Reproduced`を同じbadgeにする。
- すべての外部version組合せをsupportしようとする。
- GitHub Wrapperの登録件数を主要KPIにする。

---

# Part II. 二つの文書の批判的統合

## 3. 両文書が正しく捉えていること

### 3.1 Wrapperは完成形ではない

GitHub Wrapper単体の価値は限定的である。Repository名、stars、README要約、frameworkタグだけならGitHubやQCRで足りる。

Atlas独自の価値は次の後段で生まれる。

```text
GitHub URL
→ paper-associated commit
→ environment completeness
→ VQE component extraction
→ missing-information report
→ comparability report
→ execution evidence
→ claim-level reproduction
```

### 3.2 広さと深さを分ける必要がある

全libraryを同じ深さで扱うと、保守コストが指数的に増える。したがって、次を分ける。

- **Index coverage:** 広くする
- **Structured coverage:** 段階的に広げる
- **Execution coverage:** 狭く、明示的に保証する
- **Claim reproduction:** 厳選された重要論文に限定する

### 3.3 versionは多層である

少なくとも以下を別identityとして管理する。

1. Scientific Method Version
2. Source Revision
3. Provider Release
4. Adapter Release
5. Runtime Profile
6. Dataset Snapshot
7. Protocol Version
8. Evidence Revision

### 3.4 FrozenとCurrentを分ける必要がある

- Frozen laneは論文時点を保存する。
- Current laneは現在のecosystemで動くかを検査する。
- Latest Observed laneはupstream変化を監視するだけで、自動verificationしない。

## 4. 両文書に対する修正

### 4.1 「完全対応」は使わない

Qiskit NatureやPennyLaneには非常に広い機能がある。「Qiskit完全対応」は検証不能な主張になる。

代わりに、以下を公開する。

```text
Provider: Qiskit Nature
Provider version: 0.8.0
Runtime: qiskit-current-linux-x86_64-py312
Capability: ElectronicStructureProblem import
Status: verified
Evidence: golden tests H2, LiH
Last verified: ...
```

### 4.2 最初から全Libraryの完全MethodGraphを作らない

READMEとimport解析だけでは、parameter flowやmeasurement lifecycleまで正確に理解できない。

初期は以下のみ抽出する。

- method names
- package roles
- example molecules
- declared basis/mapping/ansatz
- optimizer candidates
- environment files
- paper association
- license
- tests/CIの存在

精密MethodGraphは、重要Repositoryをhuman-reviewed corpusへ選んだ後に作る。

### 4.3 ontologyはgolden corpusから育てる

初期から全論文を表せる巨大ontologyを作らない。

```text
stable typed core
+
versioned domain JSON
+
evidence-grounded assertions
+
unknown/ambiguous states
```

で始める。

### 4.4 confidence数値を権威にしない

`confidence=0.97`だけでは研究者に意味がない。

必ずevidence classを併記する。

```text
declared_in_citation
declared_in_readme
declared_in_config
detected_in_ast
detected_in_runtime
inferred_by_rule
inferred_by_llm
confirmed_by_author
confirmed_by_reviewer
verified_by_execution
```

---

# Part III. 研究者にとっての実用性

## 5. 主要Jobs-to-be-Done

### JTBD-1: 過去手法をbaselineとして動かす

研究者の問い:

- どのRepositoryが公式実装か。
- 論文時点のcommitはどれか。
- どのPython/package versionを使うか。
- exampleはどのcommandで動くか。
- reported resultとどこまで一致したか。

Atlasの出力:

```text
Official implementation: confirmed / candidate / unknown
Paper-associated commit: SHA
Environment: complete / partial / absent
Install status: passed / failed
Example status: passed / failed
Numerical status: matched / mismatched / inconclusive
```

### JTBD-2: 二つのVQE手法を公平に比較する

研究者の問い:

- molecule、geometry、basisは同じか。
- active space、mapping、taperingは同じか。
- pool、optimizer、stoppingは同じか。
- logical circuitかcompiled circuitか。
- measurement costの定義は同じか。

Atlasの出力:

```text
Comparability: strict / controlled / partial / invalid
Fixed dimensions: [...]
Changed dimensions: [...]
Unknown dimensions: [...]
Blocking mismatches: [...]
```

### JTBD-3: 部品を再利用する

研究者の問い:

- operator poolだけ再利用できるか。
- Qiskit実装をPennyLane workflowへ移せるか。
- required input/output contractは何か。
- license上copy可能か、external dependencyとして使うべきか。

### JTBD-4: 最新研究を追う

研究者の問い:

- 新しい論文にcodeがあるか。
- 最新releaseでscientific configurationが変わったか。
- mainは論文時点からどの程度driftしたか。
- current environmentでまだ動くか。

### JTBD-5: 自分の研究を公開する

著者の利益:

- persistent versioned record
- author claim
- metadata correction
- executable badge
- claim reproduction badge
- machine-readable experiment card
- citation/export
- reviewer向けartifact page

## 6. 研究者向けEvidence Level

```text
L0 Discovered
URLまたは論文を発見しただけ。

L1 Indexed
Repository ID、固定commit、license候補、paper relationを保存した。

L2 Structured
VQE metadataをschemaへ抽出した。未reviewを含む。

L3 Reviewed
人間reviewerまたは著者がmetadataを確認した。

L4 Installable
固定runtimeでdependency installation/importが成功した。

L5 Executable
指定exampleまたはentrypointが成功した。

L6 Numerically Verified
energy、Hamiltonian、gradientなどを独立checkした。

L7 Claim Reproduced
論文の特定table、figure、数値claimを許容誤差内で再現した。

L8 Independently Replicated
公式codeと独立した実装でもclaimを再現した。
```

各levelはartifact全体へ一括付与しない。原則として次のtupleへ付与する。

```text
Claim
× ImplementationVersion
× ProblemSpec
× ProtocolVersion
× RuntimeProfile
```

---

# Part IV. 現行Majoranaの評価

## 7. 現行構造の強み

現行Atlasには次がある。

- `Artifact`による安定identity
- `ArtifactVersion`によるimmutable version
- source hash、semantic fingerprint、toolchain digest
- provenance、license assertion、citation、tags
- importerとreviewerの権限分離
- import job/itemのdurable state
- item単位transaction
- public publication gate
- deny-all sandbox
- Qiskit/PennyLane/Cirq向けnative circuit observer
- `uv.lock`を使うfrozen build
- API/Workerのnon-root runtime

これらはGitHub WrapperとVQE registryの土台として再利用する。

## 8. 現行構造の不足

### 8.1 `ArtifactSource`が一対一

一つのArtifactVersionに対して、

- paper
- supplement
- Repository snapshot
- source file
- dataset
- package release

が複数関係するため、一対一では不足する。

### 8.2 import一件がArtifact一件

一つのRepositoryから複数algorithm、pool、dataset、exampleを抽出できない。

### 8.3 `ArtifactVersion.code`とpresentation JSONの混在

現行bootstrap corpusでは表示用JSONがsource blobとして保存されている。real code providerでは`record=None`になる。表示payloadを分離する必要がある。

### 8.4 current `FrameworkAdapter`はcircuit中心

既存protocolは、

- contract diagnostics
- native optimization
- resource metrics
- trusted setup
- trusted observer

を扱う。VQE problem、operator pool、optimizer、measurement protocolの抽出とは責務が違う。

### 8.5 sandbox versionと最新ecosystemの差

現行一般sandboxは以下を固定している。

```text
Python 3.13
Qiskit 2.5.0
Qiskit Aer 0.17.2
PennyLane 0.43.1
Cirq Core 1.6.1
```

一方、調査時のPennyLane stableは0.45.1である。既存一般sandboxを常時latestへ変更せず、VQE runtime profilesを独立させる。

### 8.6 control planeとscientific runtimeの分離不足

APIとWorkerは同一imageを利用する。これはorchestrationにはよいが、重いscientific packageを入れる場所ではない。

## 9. 変更しないもの

- Neonをcanonical databaseとする。
- DB accessはAPI repository layerだけに限定する。
- importer authorityとreviewer authorityを分ける。
- public APIから直接publishしない。
- sandbox executionはdeny-all networkを維持する。
- immutable ArtifactVersionを維持する。
- current general circuit sandboxはVQE profile完成まで変更しない。

---

# Part V. 目標アーキテクチャ

## 10. 全体構造

```text
                         ┌─────────────────────────┐
                         │ GitHub / arXiv / DOI    │
                         │ Package Index / Dataset │
                         └────────────┬────────────┘
                                      │
                             Source Discovery
                                      │
                         ┌────────────▼────────────┐
                         │ Ingestion Control Plane │
                         │ FastAPI + Neon          │
                         └────────────┬────────────┘
                                      │
               ┌──────────────────────┼──────────────────────┐
               │                      │                      │
       Metadata Fetch Queue   Static Extraction Queue   Update Check Queue
               │                      │                      │
               ▼                      ▼                      ▼
      Quarantine/Object Store   Assertion Ledger      Snapshot Diff
               │                      │
               └──────────────┬───────┘
                              ▼
                    Human Review / Author Claim
                              │
                              ▼
                   Artifact / VQE Structured Card
                              │
                              ▼
                      Execution Broker
                              │
      ┌───────────────────────┼────────────────────────┐
      ▼                       ▼                        ▼
Qiskit CPU profile    PennyLane CPU profile      Isolated profiles
                                                  Tangelo/OpenVQE/
                                                  CUDA-QX CPU/GPU
      │                       │                        │
      └───────────────────────┼────────────────────────┘
                              ▼
                  Evidence + Drift + Comparison
                              │
                              ▼
                       Public Atlas API/UI
```

## 11. Trust boundary

### Control Plane

保持するもの:

- DB credentials
- GitHub App credentials
- publication authority
- queue authority
- object storage credentials

実行しないもの:

- untrusted Repository code
- arbitrary package installation
- notebook execution

### Fetch Process

保持するもの:

- 最小限のGitHub App tokenまたはread token
- bounded fetch policy

保持しないもの:

- Neon credentials
- publication credentials
- QPU credentials

### Extraction Process

- networkなし
- DB direct writeなし
- tool-free LLM
- schema-constrained output
- Repository textをinstructionとして解釈しない

### Execution Runtime

- network deny
- no credentials
- read-only source
- exact image digest
- CPU/memory/pids/time/output制限
- writable temporary directoryのみ
- runtime install禁止

---

# Part VI. Data Model

## 12. Identityの原則

次のidentityを混同しない。

```text
ExternalRepository identity
  provider + provider_repository_id

RepositorySnapshot identity
  external_repository_id + commit_sha

SourceBlob identity
  sha256(bytes)

Scientific Artifact identity
  Artifact.id

ArtifactVersion identity
  ArtifactVersion.id

Method identity
  literature method + version

Runtime identity
  OCI image digest + lock digest

Evidence identity
  execution/review run ID
```

同じsource bytesが別Repositoryに存在しても、provenanceを消さない。

## 13. 新規table群

### 13.1 `external_repositories`

```sql
id UUID PRIMARY KEY
provider TEXT NOT NULL
provider_repository_id TEXT NOT NULL
provider_node_id TEXT
owner TEXT NOT NULL
name TEXT NOT NULL
canonical_url TEXT NOT NULL
default_branch TEXT
visibility TEXT
owner_type TEXT
is_fork BOOLEAN NOT NULL DEFAULT FALSE
parent_repository_id UUID NULL
archived BOOLEAN NOT NULL DEFAULT FALSE
disabled BOOLEAN NOT NULL DEFAULT FALSE
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
last_seen_at TIMESTAMPTZ

UNIQUE(provider, provider_repository_id)
```

### 13.2 `repository_snapshots`

```sql
id UUID PRIMARY KEY
repository_id UUID NOT NULL REFERENCES external_repositories(id)
commit_sha TEXT NOT NULL
tree_sha TEXT
resolved_from_ref TEXT
release_tag TEXT
release_id TEXT
commit_authored_at TIMESTAMPTZ
commit_committed_at TIMESTAMPTZ
retrieved_at TIMESTAMPTZ NOT NULL
manifest_object_uri TEXT
manifest_sha256 TEXT NOT NULL
snapshot_state TEXT NOT NULL
source_api_version TEXT
retrieval_metadata JSONB

UNIQUE(repository_id, commit_sha)
```

`snapshot_state`:

```text
discovered
fetching
quarantined
manifested
extracted
reviewed
rejected
unavailable
```

### 13.3 `source_blobs`

```sql
id UUID PRIMARY KEY
sha256 TEXT NOT NULL UNIQUE
size_bytes BIGINT NOT NULL
media_type TEXT
encoding TEXT
object_uri TEXT NOT NULL
first_seen_at TIMESTAMPTZ
malware_scan_state TEXT
secret_scan_state TEXT
```

### 13.4 `repository_snapshot_files`

重要fileのみrow化する。全treeはmanifest objectへ保存する。

```sql
id UUID PRIMARY KEY
snapshot_id UUID NOT NULL REFERENCES repository_snapshots(id)
path TEXT NOT NULL
git_blob_sha TEXT
source_blob_id UUID REFERENCES source_blobs(id)
size_bytes BIGINT NOT NULL
language TEXT
file_role TEXT NOT NULL
is_generated BOOLEAN
is_binary BOOLEAN
parse_state TEXT

UNIQUE(snapshot_id, path)
```

`file_role`:

```text
readme
license
notice
citation
codemeta
dependency_manifest
lockfile
container_definition
workflow
source_entrypoint
source
test
example
notebook
config
dataset_manifest
result
other
```

### 13.5 `artifact_source_links`

既存一対一`ArtifactSource`を即削除せず、many-to-manyを追加する。

```sql
id UUID PRIMARY KEY
artifact_version_id UUID NOT NULL REFERENCES artifact_versions(id)
repository_snapshot_id UUID REFERENCES repository_snapshots(id)
source_blob_id UUID REFERENCES source_blobs(id)
citation_id UUID REFERENCES artifact_citations(id)
relation TEXT NOT NULL
path_scope JSONB
association_status TEXT NOT NULL
evidence_assertion_id UUID
confidence NUMERIC
reviewer_user_id UUID
created_at TIMESTAMPTZ

UNIQUE(artifact_version_id, repository_snapshot_id, relation, path_scope)
```

`relation`:

```text
official_implementation
author_implementation
independent_reimplementation
derived_from
source_file
benchmark_code
dataset_source
documentation
example_only
fork
mirror
paper_supplement
```

### 13.6 `metadata_extraction_runs`

```sql
id UUID PRIMARY KEY
snapshot_id UUID NOT NULL
extractor_kind TEXT NOT NULL
extractor_name TEXT NOT NULL
extractor_version TEXT NOT NULL
schema_version TEXT NOT NULL
model_provider TEXT
model_name TEXT
model_revision TEXT
prompt_version TEXT
input_manifest_sha256 TEXT NOT NULL
status TEXT NOT NULL
started_at TIMESTAMPTZ
finished_at TIMESTAMPTZ
error_code TEXT
metrics JSONB
```

`extractor_kind`:

```text
github_api
declaration_parser
python_ast
notebook_parser
regex_rule
llm
manual
runtime_observer
author_submission
```

### 13.7 `metadata_assertions`

```sql
id UUID PRIMARY KEY
extraction_run_id UUID NOT NULL
subject_type TEXT NOT NULL
subject_id UUID
field_path TEXT NOT NULL
value_json JSONB NOT NULL
normalized_value_json JSONB
evidence_kind TEXT NOT NULL
source_file_id UUID
line_start INTEGER
line_end INTEGER
symbol_path TEXT
confidence NUMERIC
review_state TEXT NOT NULL
reviewer_user_id UUID
reviewer_value_json JSONB
supersedes_assertion_id UUID
created_at TIMESTAMPTZ
```

### 13.8 `assertion_conflicts`

```sql
id UUID PRIMARY KEY
subject_type TEXT
subject_id UUID
field_path TEXT
assertion_a_id UUID
assertion_b_id UUID
conflict_kind TEXT
resolution_state TEXT
resolved_assertion_id UUID
reviewer_user_id UUID
created_at TIMESTAMPTZ
resolved_at TIMESTAMPTZ
```

### 13.9 `extraction_candidates`

```sql
id UUID PRIMARY KEY
snapshot_id UUID NOT NULL
candidate_type TEXT NOT NULL
proposed_title TEXT
proposed_slug TEXT
proposed_spec JSONB
boundary_paths JSONB
classification_state TEXT
review_state TEXT
resulting_artifact_id UUID
resulting_version_id UUID
created_at TIMESTAMPTZ
reviewed_at TIMESTAMPTZ
```

`candidate_type`:

```text
method
implementation
component
problem
dataset
benchmark
experiment
reproduction_package
documentation
```

### 13.10 `catalog_entry_payloads`

```sql
artifact_version_id UUID PRIMARY KEY
schema_version TEXT NOT NULL
public_record JSONB NOT NULL
search_summary JSONB
generated_from_assertion_set_sha256 TEXT
generated_at TIMESTAMPTZ
reviewed_at TIMESTAMPTZ
```

### 13.11 `software_packages`

```sql
id UUID PRIMARY KEY
ecosystem TEXT NOT NULL
normalized_name TEXT NOT NULL
display_name TEXT NOT NULL
homepage TEXT
repository_id UUID
default_role TEXT
license_candidate TEXT

UNIQUE(ecosystem, normalized_name)
```

### 13.12 `provider_releases`

```sql
id UUID PRIMARY KEY
software_package_id UUID NOT NULL
version TEXT NOT NULL
source_commit TEXT
release_date DATE
python_constraint TEXT
upstream_status TEXT
distribution_metadata JSONB
release_attestation JSONB

UNIQUE(software_package_id, version)
```

### 13.13 `artifact_package_bindings`

```sql
id UUID PRIMARY KEY
artifact_version_id UUID NOT NULL
software_package_id UUID NOT NULL
declared_spec TEXT
resolved_release_id UUID
source_commit TEXT
role TEXT NOT NULL
detection_kind TEXT NOT NULL
confidence NUMERIC
review_state TEXT
runtime_observed BOOLEAN

UNIQUE(artifact_version_id, software_package_id, role, detection_kind)
```

### 13.14 `capability_definitions`

```sql
id UUID PRIMARY KEY
domain TEXT NOT NULL
capability_key TEXT NOT NULL
title TEXT NOT NULL
description TEXT NOT NULL
input_contract JSONB
output_contract JSONB
verification_protocol_key TEXT

UNIQUE(domain, capability_key)
```

例:

```text
vqe.problem.electronic_structure
vqe.mapping.jordan_wigner
vqe.ansatz.uccsd
vqe.algorithm.vqe_exact
vqe.algorithm.adapt_vqe
vqe.measurement.finite_shot
vqe.backend.qpu
```

### 13.15 `runtime_profiles`

```sql
id UUID PRIMARY KEY
profile_key TEXT NOT NULL UNIQUE
lane TEXT NOT NULL
status TEXT NOT NULL
os_name TEXT
os_version TEXT
architecture TEXT
python_version TEXT
container_image TEXT
container_digest TEXT
uv_lock_sha256 TEXT
pylock_sha256 TEXT
sbom_sha256 TEXT
build_attestation JSONB
network_policy TEXT
created_at TIMESTAMPTZ
promoted_at TIMESTAMPTZ
deprecated_at TIMESTAMPTZ
```

`lane`:

```text
frozen
current
latest_observed
experimental
```

`status`:

```text
candidate
supported_current
supported_previous
frozen_reproducible
metadata_only
optional_execution
upstream_broken
security_blocked
deprecated
unavailable
```

### 13.16 `runtime_profile_packages`

```sql
runtime_profile_id UUID
provider_release_id UUID
distribution_filename TEXT
distribution_sha256 TEXT
installation_source TEXT
PRIMARY KEY(runtime_profile_id, provider_release_id)
```

### 13.17 `adapter_releases`

```sql
id UUID PRIMARY KEY
adapter_key TEXT NOT NULL
adapter_version TEXT NOT NULL
source_commit TEXT NOT NULL
input_schema_version TEXT NOT NULL
output_schema_version TEXT NOT NULL
supported_provider_ranges JSONB
known_incompatibilities JSONB
created_at TIMESTAMPTZ

UNIQUE(adapter_key, adapter_version)
```

### 13.18 `capability_support`

```sql
id UUID PRIMARY KEY
runtime_profile_id UUID NOT NULL
adapter_release_id UUID
capability_id UUID NOT NULL
support_state TEXT NOT NULL
evidence_run_id UUID
last_verified_at TIMESTAMPTZ
notes TEXT

UNIQUE(runtime_profile_id, adapter_release_id, capability_id)
```

`support_state`:

```text
not_evaluated
unsupported
experimental
supported
verified
blocked
regressed
```

### 13.19 `dataset_snapshots`

```sql
id UUID PRIMARY KEY
provider TEXT NOT NULL
dataset_key TEXT NOT NULL
provider_release TEXT
retrieved_at TIMESTAMPTZ
manifest_sha256 TEXT
license_id TEXT
terms_snapshot JSONB
preprocessing_version TEXT
object_uri TEXT

UNIQUE(provider, dataset_key, manifest_sha256)
```

### 13.20 `benchmark_protocol_versions`

```sql
id UUID PRIMARY KEY
protocol_key TEXT NOT NULL
version TEXT NOT NULL
definition_json JSONB NOT NULL
metric_definitions JSONB NOT NULL
acceptance_rules JSONB
source_citation_id UUID
created_at TIMESTAMPTZ

UNIQUE(protocol_key, version)
```

### 13.21 `vqe_specs`

```sql
artifact_version_id UUID PRIMARY KEY
schema_version TEXT NOT NULL
entry_type TEXT NOT NULL
method_family TEXT
component_type TEXT
metadata_completeness NUMERIC
spec_json JSONB NOT NULL
unknown_fields JSONB
ambiguous_fields JSONB
created_at TIMESTAMPTZ
```

### 13.22 `vqe_spec_facets`

```sql
id UUID PRIMARY KEY
artifact_version_id UUID NOT NULL
facet_type TEXT NOT NULL
normalized_value TEXT NOT NULL
raw_value JSONB
source_assertion_id UUID

INDEX(facet_type, normalized_value)
```

### 13.23 `compatibility_runs`

```sql
id UUID PRIMARY KEY
artifact_version_id UUID NOT NULL
runtime_profile_id UUID NOT NULL
adapter_release_id UUID
status TEXT NOT NULL
stage_reached TEXT
started_at TIMESTAMPTZ
finished_at TIMESTAMPTZ
failure_code TEXT
result_json JSONB
environment_observation JSONB
```

### 13.24 `semantic_drift_reports`

```sql
id UUID PRIMARY KEY
base_compatibility_run_id UUID NOT NULL
candidate_compatibility_run_id UUID NOT NULL
drift_class TEXT NOT NULL
severity TEXT NOT NULL
dimension_diffs JSONB NOT NULL
review_state TEXT
reviewer_user_id UUID
created_at TIMESTAMPTZ
```

`drift_class`:

```text
none
api_only
metadata_only
numerical_precision
default_behavior
scientific_semantic
resource_metric
unknown
```

### 13.25 Claim/Evidence tables

```sql
scientific_claims
claim_evidence_links
reproduction_attempts
metric_observations
comparison_sets
comparison_dimensions
```

これらはVQE executionの後段で追加する。最初のGitHub import PRへ含めない。

---

# Part VII. Generic Interfaces

## 14. Source Provider contract

```python
from typing import Protocol, Iterable

class SourceProvider(Protocol):
    provider_key: str

    async def resolve_repository(self, locator: str) -> "RepositoryIdentity":
        ...

    async def resolve_snapshot(
        self,
        repository: "RepositoryIdentity",
        requested_ref: str | None,
    ) -> "ResolvedSnapshot":
        ...

    async def fetch_manifest(
        self,
        snapshot: "ResolvedSnapshot",
        policy: "FetchPolicy",
    ) -> "SnapshotManifest":
        ...

    async def fetch_selected_files(
        self,
        snapshot: "ResolvedSnapshot",
        selections: Iterable["FileSelection"],
        policy: "FetchPolicy",
    ) -> list["FetchedFile"]:
        ...
```

### SourceProviderは禁止事項

- Artifactを直接publishしない。
- DBへ直接接続しない。
- unbounded cloneをしない。
- caller指定の任意hostへアクセスしない。
- branch refを永続identityとして返さない。
- executionを行わない。

## 15. Scientific Adapter contract

```python
class ScientificAdapter(Protocol):
    adapter_key: str
    adapter_version: str

    def detect(
        self,
        snapshot: "ExtractionInput",
    ) -> list["MetadataAssertion"]:
        ...

    def propose_candidates(
        self,
        snapshot: "ExtractionInput",
        assertions: list["MetadataAssertion"],
    ) -> list["ExtractionCandidate"]:
        ...

    def canonicalize(
        self,
        candidate: "ReviewedCandidate",
    ) -> "DomainSpec":
        ...
```

## 16. Execution Adapter contract

既存`FrameworkAdapter`を置換しない。VQE用に別interfaceを追加する。

```python
class ScientificExecutionAdapter(Protocol):
    adapter_key: str
    runtime_profile_key: str

    def preflight(self, experiment: "ExperimentSpec") -> "PreflightReport":
        ...

    def materialize(self, experiment: "ExperimentSpec") -> "ExecutionBundle":
        ...

    def observe(self, output_dir: str) -> "ExecutionObservation":
        ...

    def normalize(self, observation: "ExecutionObservation") -> "NormalizedResult":
        ...

    def verify(
        self,
        experiment: "ExperimentSpec",
        result: "NormalizedResult",
    ) -> "VerificationReport":
        ...
```

---

# Part VIII. GitHub Wrapper

## 17. Initial acquisition mode

### Phase 1 input

手動入力のみ。

```text
GitHub Repository URL
optional requested ref
optional paper DOI/arXiv
optional submitter relation
```

### Resolver処理

1. URLをparseする。
2. GitHub numeric repository IDを取得する。
3. owner/name/canonical URLを取得する。
4. requested refまたはdefault branchをcommit SHAへresolveする。
5. tree SHAを取得する。
6. snapshot rowを作る。
7. conditional metadataを取得する。
8. selected filesをbounded fetchする。
9. bytesをquarantineへ保存する。
10. SHA-256を再計算する。
11. static extraction jobをenqueueする。

## 18. GitHub App permissions

初期権限は最小化する。

```text
Repository metadata: read
Contents: read
```

初期には不要:

```text
Issues
Pull requests
Actions
Administration
Secrets
Deployments
Checks
Write permissions
```

著者claimやwebhookを追加するときも、権限追加は別ADR・別PRで行う。

## 19. GitHub API version

全requestに明示する。

```text
X-GitHub-Api-Version: 2026-03-10
Accept: application/vnd.github+json
```

API versionはconfigurationとして固定し、parser contract fixtureを作る。

## 20. Fetch limits

初期default:

```text
Max repositories per import job: 20
Max selected files per repository: 200
Max individual text file: 2 MiB
Max aggregate fetched text: 32 MiB
Max manifest entries inspected: 100,000
Max notebook source: 5 MiB
Max README/LICENSE/CITATION: 2 MiB each
Redirects: GitHub API clientの公式redirect handlingのみ
Binary source: metadataのみ、content拒否
Git LFS: pointer metadataのみ
Submodules: metadataのみ
Archives: 展開禁止
Symlinks: content dereference禁止
```

値はADRで承認し、configurationにする。caller変更不可。

## 21. Tree API fallback

Git tree recursive responseがtruncateされた場合:

1. `truncated=true`を記録。
2. root treeをnon-recursive取得。
3. relevant directoriesだけbreadth-first取得。
4. path allowlistとbudgetを適用。
5. budget超過なら`manifest_partial`として公開し、完全manifestと主張しない。

## 22. Initial selected paths

優先順位:

```text
README*
LICENSE*
COPYING*
NOTICE*
CITATION.cff
codemeta.json
pyproject.toml
setup.py
setup.cfg
requirements*.txt
environment*.yml
conda*.yml
poetry.lock
uv.lock
pylock*.toml
Pipfile.lock
Dockerfile*
docker-compose*.yml
.github/workflows/**
examples/**
notebooks/**
tests/**
benchmarks/**
src/**
```

`src/**`は全取得せず、AST/import graphに必要なbudgeted subsetを選ぶ。

## 23. Idempotency

idempotency key:

```text
github-import:
  provider_repository_id
  resolved_commit_sha
  importer_policy_version
```

同じsnapshotを再importした場合:

- source bytesを重複保存しない。
- extraction runはextractor versionが変わった場合のみ新規作成可能。
- publication stateは自動変更しない。

## 24. Update tracking

### Claimed Repository

GitHub App installationがある場合:

- push
- release
- repository
- installation

webhookを受信する。

webhook処理:

1. raw bodyでHMAC SHA-256を検証。
2. delivery IDでdeduplicate。
3. eventをdurable保存。
4. payloadをsource of truthにせず、APIから最終状態を再取得。
5. commit SHAが未登録ならsnapshot jobを作る。

### Unclaimed Repository

conditional polling:

- ETag
- Last-Modified
- adaptive interval
- archived/disabled時は低頻度化
- paper-critical Repositoryは優先
- 304時は更新なし

---

# Part IX. Metadata Extraction

## 25. 抽出順序

必ず次の順序で行う。

### Stage A: Provider facts

- Repository ID
- owner/name
- commit/tree SHA
- release/tag
- topics
- archived/fork
- detected license candidate

### Stage B: Declaration files

- CITATION.cff
- codemeta.json
- pyproject.toml
- requirements
- lockfiles
- Dockerfile
- CI workflow
- environment.yml

### Stage C: Static code analysis

- imports
- symbol references
- function/class definitions
- literal configuration
- CLI entrypoints
- molecule/basis strings
- optimizer constructors
- mapper constructors
- ansatz constructors
- dataset loaders

### Stage D: Notebook sanitation and analysis

処理:

1. output cellを除去する。
2. attachmentsを除去する。
3. markdownとcodeを別channelでparseする。
4. base64/binaryを拒否する。
5. executionしない。
6. cell indexをevidence locationとして保存する。

### Stage E: LLM extraction

LLMは補助。

- tool accessなし
- networkなし
- system prompt固定
- source textは`UNTRUSTED_DATA`として囲む
- JSON schema outputのみ
- assertionごとにsource locator必須
- evidenceなしfieldは禁止
- publish権限なし

### Stage F: Human review

reviewerは、

- candidate boundary
- official implementation relation
- method family
- package role
- ambiguous conflict
- publication readiness

を確認する。

## 26. 初期抽出field

### General

```text
title
description
authors
paper DOI/arXiv
license
official-status
installation documentation
test presence
CI presence
container presence
lockfile presence
supported platforms
```

### VQE

```text
method_family
component_type
molecules
geometries
charge
multiplicity
basis_sets
active_space
frozen_core
chemistry_driver
fermion_mapping
tapering
qubit_order
reference_state
ansatz
operator_pool
adaptive_scoring
selection_rule
batching
optimizer
initialization
stopping_rule
measurement_estimator
shots
grouping
mitigation
compiler
backend
seeds
reported_metrics
```

### Unknown states

各fieldはnullではなく、必要に応じて次を持てる。

```text
not_reported
not_found
ambiguous
conflicting
not_applicable
requires_execution
requires_paper
requires_author_confirmation
```

## 27. Package role判定

以下を区別する。

```text
declared_dependency
locked_dependency
imported_package
symbol_used
runtime_imported
runtime_role_observed
role_inferred
role_reviewed
```

例:

`scipy`がrequirementsに存在しても、optimizerとして使用されたとは断定しない。

---

# Part X. Framework and Library Strategy

## 28. Role分類

### Execution framework

- Qiskit
- PennyLane
- Cirq
- CUDA-Q

### Scientific library

- Qiskit Nature
- OpenFermion
- QURI Parts
- Tangelo
- OpenVQE
- CUDA-QX Solvers

### Algorithm library

- Qiskit Algorithms
- CUDA-QX Solvers
- OpenVQE

### Chemistry driver

- PySCF
- Psi4等

### Dataset provider

- HamLib
- PennyLane Datasets

### Benchmark protocol

- QuantMark
- Atlas native protocols

### Simulator

- Qiskit Aer
- PennyLane default.qubit
- Qulacs等

## 29. Phase 1 native Qiskit profile

### Candidate versions at investigation date

```text
Python 3.12
qiskit == 2.5.0
qiskit-aer == 0.17.2
qiskit-nature == 0.8.0
qiskit-algorithms == 0.4.0
pyscf == 2.14.0
```

**状態:** `CANDIDATE_UNVERIFIED`

実際のprofileを確定する前に:

1. isolated `pyproject.toml`を作る。
2. `uv lock`を実行する。
3. wheel availabilityを確認する。
4. `uv sync --frozen`する。
5. import conformanceを実行する。
6. H2/LiH golden testsを実行する。
7. image digestとSBOMを生成する。
8. human promotion reviewを行う。

### Initial supported capabilities

```text
ElectronicStructureProblem
PySCFDriver
ActiveSpaceTransformer
FreezeCoreTransformer
JordanWignerMapper
ParityMapper
HartreeFock initial state
UCCSD ansatz
VQE with exact/statevector estimator
VQE with finite shots on Aer
AdaptVQE small-problem execution
Hamiltonian canonical export
Final circuit/resource observation
```

### Initial unsupported

```text
QEOM
vibrational structure
arbitrary QPU execution
all mapper variants
all optimizer variants
large active spaces
GPU Aer
external credentials
```

## 30. Phase 1 native PennyLane profile

### Candidate versions

```text
Python 3.12
pennylane == 0.45.1
pyscf == 2.14.0
openfermion == 1.7.1  # optional candidate; resolver/test必須
```

**状態:** `CANDIDATE_UNVERIFIED`

### Initial supported capabilities

```text
qml.qchem.Molecule
molecular_hamiltonian
Hartree-Fock state
qchem excitations
UCCSD template
default.qubit
Autograd
exact expectation
finite-shot expectation
Hamiltonian canonical export
QNode/tape resource observation
```

### Initial experimental

```text
JAX
Torch
geometry optimization
trainable Hamiltonian parameters
external devices
```

### Initial unsupported

```text
Catalyst/qjit
hardware execution
all differentiation methods
all device plugins
```

## 31. OpenFermion

初期からadapterを作る。ただしexecution frameworkにしない。

用途:

- `FermionOperator`
- `QubitOperator`
- `InteractionOperator`
- `MolecularData`
- mapping/conversion
- canonical operator serialization

保存時:

- Python objectをpickleしない。
- canonical JSON/NPZ/HDF5 manifestへ変換する。
- coefficient dtype、endianness、orbital order、qubit orderを保存する。
- source package/releaseを保存する。

## 32. PySCF

Qiskit/PennyLane両profileのchemistry driver candidate。

注意:

- wheel hashを保存する。
- source buildを初期productionで許さない。
- `--only-binary`相当のpolicyを優先する。
- SCF convergence、symmetry、integral thresholdをExperimentSpecへ保存する。
- PySCF updateによるintegral/orbital driftをgolden testする。

## 33. PennyLane Datasets

初期からdataset importerを実装する。

保存:

```text
dataset identifier
attributes requested
provider metadata
retrieved files
blob hashes
license/terms snapshot
PennyLane release
retrieval date
preprocessing version
```

注意:

- provider側datasetは増補・変更され得る。
- library versionだけをdataset versionとみなさない。
- `vqe_params`や`vqe_energy`があってもpaper claim reproductionとは呼ばない。

## 34. HamLib

初期からdataset manifest importerを作る。

- 全datasetを複製しない。
- selected golden instancesから始める。
- item単位のlicenseを保存する。
- file hashとgeneration metadataを保存する。
- molecular metadataが不足する場合は推測しない。
- qubit Hamiltonianだけなら`electronic_structure_details=unavailable`とする。

## 35. QuantMark

production Python dependencyにしない。

初期成果物:

```text
quantmark-2022-paper-v1
metric crosswalk
benchmark condition summary
known limitations
Atlas extension mapping
```

実装:

- `benchmark_protocol_versions`へpaper-derived protocolを保存する。
- paper記載とAtlas interpretationを分離する。
- code sourceが確認できない場合は`literature_protocol_only`とする。
- QuantMark互換metricとAtlas独自metricを混同しない。

## 36. Tangelo

### Phase 1

- metadata index
- dependency capture
- example classification
- documented workflow extraction

### Phase 2

専用profile:

```text
tangelo-0.4.3-cpu
Python versionはresolverで確定
tangelo-gc == 0.4.3
selected backendのみ
```

禁止:

- official exampleのdynamic `pip install`をproductionで再現しない。
- 全optional backendを同一imageへ入れない。

最初のexecution:

- H2またはLiH
- one VQE solver
- one backend
- exact simulator
- normalized result export

## 37. OpenVQE

### Phase 1

- official Repository snapshot
- paper relation
- MIT license
- UCC/fermionic ADAPT/qubit ADAPT classification
- Linux/myQLM/PySCF/CUDA dependency metadata
- known Qiskit environment conflictをrecord

### Execution policy

- current general sandboxへ入れない。
- paper-associated commitを選ぶ。
-専用legacy image。
- network/credentialsなし。
- Linux x86_64から開始。
- selected notebook/exampleのみ。
- GPU-dependent battery applicationは別profile。

## 38. CUDA-QX Solvers

### Phase 1

- metadata index
- VQE/ADAPT/operator pool capability extraction
- package release record
- CPU/GPU requirement extraction

### Phase 2 CPU

候補:

```text
cudaq-solvers == 0.6.0
Python >= 3.11
CUDA-Q compatible exact release
libgfortran
Linux container
```

lock/testで確定する。

### Phase 3 GPU

別worker pool。

- NVIDIA driver compatibility
- GPU model
- CUDA version
- memory limit
- cost quota
- deterministic seed
- execution queue
- QPU credentialsと完全分離

---

# Part XI. Runtime Profiles and Dependency Management

## 39. Directory layout

```text
runtimes/
  vqe/
    qiskit-current/
      pyproject.toml
      uv.lock
      pylock.toml
      sbom.cdx.json
      Dockerfile
      profile.yaml
      tests/
    qiskit-paper-legacy-<paper-key>/
    pennylane-current/
    tangelo-0.4.3-cpu/
    openvqe-<commit>-legacy/
    cudaqx-0.6-cpu/
    cudaqx-0.6-gpu/
```

これらをroot uv workspaceに無条件で追加しない。

理由:

- mutually incompatible dependency graphがある。
- root `uv.lock`を巨大化・不安定化する。
- API/Worker buildへscientific dependenciesが入る。

各runtimeを独立uv projectとする。必要ならCI matrixでdirectoryごとに実行する。

## 40. Profile manifest

```yaml
profile_key: qiskit-current-linux-x86_64-py312
lane: current
status: candidate

platform:
  os: debian-bookworm
  architecture: x86_64
  python: "3.12"

packages:
  qiskit: "2.5.0"
  qiskit-aer: "0.17.2"
  qiskit-nature: "0.8.0"
  qiskit-algorithms: "0.4.0"
  pyscf: "2.14.0"

security:
  network: deny_all
  user: non_root
  read_only_root: true
  max_cpu_seconds: 600
  max_memory_mb: 4096
  max_pids: 128
  max_output_mb: 64

artifacts:
  uv_lock_sha256: ...
  pylock_sha256: ...
  sbom_sha256: ...
  image_digest: ...

capabilities:
  - vqe.problem.electronic_structure
  - vqe.mapping.jordan_wigner
  - vqe.ansatz.uccsd
```

## 41. Required commands

profile directoryで:

```bash
uv lock
uv sync --frozen
uv run --frozen python -m profile_tests.import_conformance
uv run --frozen python -m profile_tests.scientific_smoke
uv export --frozen --format pylock.toml --output-file pylock.toml
uv export --frozen --format cyclonedx1.5 --output-file sbom.cdx.json
```

CIとDocker buildでは`--frozen`または`--locked`を使用する。

## 42. Build rules

- Docker base imageをdigest pinする。
- package indexをbuild時だけ利用する。
- runtime stageへpackage manager cacheを持ち込まない。
- non-root userを使用する。
- runtimeにcompilerを残さない。
- wheel/source distributionのhashをrecordする。
- source buildが必要なprofileは別security review。
- imageへlabelを追加する。

```text
org.opencontainers.image.revision
org.opencontainers.image.source
org.opencontainers.image.version
majorana.runtime.profile
majorana.uv.lock.sha256
majorana.sbom.sha256
```

---

# Part XII. Version Lanes

## 43. Frozen Reproduction Lane

目的:

- 論文時点のcodeと結果を維持する。

固定:

- Repository commit
- exact dependencies
- Python
- OS/image
- dataset hashes
- random seeds
- protocol version
- adapter release
- expected outputs

policy:

- package upgrade禁止
- network禁止
- credential禁止
- security vulnerabilityがあれば`security_blocked`にできる
- migration保証なし
- original environmentを上書きしない

## 44. Current Compatibility Lane

目的:

- Atlasが現在supportするecosystemで動くか確認する。

特徴:

- current/previous profileを継続CI
- migration patchを別source revisionとして保存
- original sourceとderived sourceを分離
- scientific driftをreport

## 45. Latest Observed Lane

目的:

- upstream変化の発見。

保存:

- latest commit/release
- dependency changes
- API changes
- license changes
- archive state
- metadata diff

このlaneには`verified`を自動付与しない。

---

# Part XIII. Upgrade Pipeline

## 46. Release detection

sources:

- PyPI release
- GitHub release
- official changelog
- security advisory

新version検知時:

1. `provider_release`を作る。
2. `candidate runtime profile`を作る。
3.既存supported profileを変更しない。
4. update jobをenqueueする。

## 47. Test tiers

### Tier A: Static compatibility

- dependency resolution
- wheel availability
- image build
- imports
- adapter protocol
- serialization schema
- license/SBOM
- vulnerability scan

### Tier B: Small semantic

- H2 Hamiltonian
- electron/orbital count
- HF bitstring
- one mapping
- one UCCSD ansatz
- one exact VQE energy
- one gradient
- one resource observation

### Tier C: Representative scientific

- LiH複数geometry
- active space
- frozen core
- parity/JW mapping
- AdaptVQE small pool
- finite shots
- measurement grouping
- transpiled resources

### Tier D: Full reproduction

- paper-specific problem
- paper-specific table/figure
- full optimizer trajectory
- claim tolerance
- multiple seeds

## 48. Promotion rules

### Patch update

A+B必須。結果差が出たらC。

### Minor update

A+B+C必須。

### Major/API breaking update

A+B+C、人間review必須。重要artifactにD。

### Promotion

次を全部満たす。

- lock success
- image build
- no critical unresolved vulnerability
- conformance pass
- required golden pass
- drift reviewed
- capability matrix updated
- documentation updated
- rollback image retained

## 49. Rollback

promotion後にregressionが見つかった場合:

1. profile statusを`regressed`へ変更。
2. previous profileを`supported_current`へ戻す。
3. public UIにregression banner。
4. affected evidenceを削除せず`superseded`表示。
5. failed runsをpreserve。
6. root cause issueを作る。

---

# Part XIV. Scientific Semantic Drift

## 50. Drift dimensions

### Problem

```text
geometry
charge
multiplicity
basis
ECP
electron count
orbital count
active/frozen orbitals
nuclear repulsion
integral digest
```

### Representation

```text
orbital order
spin order
mapping
qubit order
symmetry sector
tapering
Pauli term count
coefficient values
Hamiltonian digest
```

### Ansatz

```text
reference state
excitation list
excitation order
parameter count
parameter sharing
Trotter rule
gate synthesis
```

### Optimization

```text
optimizer class
default options
initial point
gradient method
stopping rule
seed
Hessian behavior
```

### Measurement

```text
estimator type
shots
grouping
allocation
mitigation
reuse
cost definition
```

### Compilation

```text
compiler version
basis gates
optimization level
layout
routing
seed
metric stage
```

## 51. Canonical comparison

Hamiltonian単純hashだけで判断しない。

比較手順:

1. identity termを分離。
2. Pauli stringをcanonical orderへ。
3. coefficient dtypeを固定。
4. zero thresholdをprotocolで固定。
5. qubit permutation候補を考慮。
6. mapping metadataを比較。
7. norm differenceを計算。

例:

```text
exact_digest_equal
permutation_equivalent
numerically_equivalent_within_tolerance
different
inconclusive
```

---

# Part XV. Golden Corpus

## 52. Initial problems

### H2

- STO-3G
- equilibrium付近
- exact diagonalization可能
- JW/Parity比較
- UCCSD

### LiH

- STO-3G
- 少なくとも2 geometry
- frozen core / no frozen core
- active space variation
- VQEとAdaptVQE

### H4

- linearまたはrectangular geometryを明示
- strong correlation test
- pool/order sensitivity

### Small Hubbard

- chemistry外のHamiltonian canonicalization確認
- dataset/provider separation確認

## 53. Golden artifacts

各problemについて保存:

```text
ProblemSpec JSON
integrals digest
fermionic Hamiltonian digest
qubit Hamiltonian digest
HF state
reference exact energy
ansatz parameter count
operator pool member digest
expected VQE tolerance
expected resource range
```

golden値は一つのframeworkのoutputを盲目的に正解としない。

- independent exact calculation
- cross-provider agreement
- reviewer approval

を必要とする。

---

# Part XVI. Comparability Engine

## 54. Comparison dimensions

```text
problem
electronic_structure
qubit_representation
reference_state
ansatz
operator_pool
adaptive_search
optimizer
initialization
measurement
compiler
backend
checkpoint
metric_definition
randomness
```

## 55. Classification

### Strict

全scientific条件とmetric protocolが一致し、implementationだけが違う。

### Controlled

明示された少数dimensionのみ異なる。

### Partial

主要条件は一致するが、unknownまたはsecondary differenceがある。

### Invalid

energy/reference/problem/cost definitionなど主要条件が一致しない。

## 56. Output example

```json
{
  "classification": "controlled",
  "fixed": [
    "problem_id",
    "basis",
    "mapping",
    "optimizer",
    "measurement_protocol"
  ],
  "changed": [
    {
      "dimension": "operator_pool",
      "baseline": "fermionic-gsd:v1",
      "candidate": "dvg-ceo:v2"
    }
  ],
  "unknown": [
    "compiler_seed"
  ],
  "blocking_mismatches": []
}
```

---

# Part XVII. API and UI

## 57. Public API

```text
GET /v1/atlas/entries
GET /v1/atlas/entries/{slug}
GET /v1/atlas/entries/{slug}/sources
GET /v1/atlas/entries/{slug}/assertions
GET /v1/atlas/entries/{slug}/vqe
GET /v1/atlas/entries/{slug}/capabilities
GET /v1/atlas/entries/{slug}/compatibility
GET /v1/atlas/entries/{slug}/claims
GET /v1/atlas/repositories/{id}
GET /v1/atlas/repositories/{id}/snapshots
GET /v1/atlas/comparisons/{id}
```

### List query

```text
q
domain
entry_type
method_family
framework
package
molecule
basis
mapping
optimizer
evidence_level
license_state
runtime_status
cursor
limit
```

server-side cursor pagination必須。全件client-side送信を廃止する。

## 58. Internal API

公開しない。

```text
POST /internal/catalog/import/github
POST /internal/catalog/extractions/{id}/review
POST /internal/catalog/candidates/{id}/materialize
POST /internal/runtime-profiles/{id}/promote
POST /internal/compatibility-runs
POST /internal/reproduction-attempts
```

全てservice principal/human adminでguardする。

## 59. UI information architecture

```text
Atlas
├── Methods
├── Implementations
├── Components
├── Problems
├── Datasets
├── Experiments
└── Claims
```

detail page:

```text
Overview
Paper
Repository & Snapshot
Implemented Components
VQE Configuration
Dependencies & Runtime
Capability Matrix
Reproducibility
Comparability
License & Rights
Evidence
Known Failures
Change History
```

## 60. Researcher-facing status

表示例:

```text
Official implementation: Author confirmed
Paper version: Reproduced
Current supported version: Executable
Latest upstream: New release, not reviewed
Metadata completeness: 82%
Known missing fields: measurement allocation, compiler seed
```

---

# Part XVIII. Security and Robustness

## 61. Threat model

攻撃対象:

- malicious README prompt injection
- dependency confusion
- typosquatting
- malicious package
- source archive bomb
- huge Repository
- symlink traversal
- Git LFS abuse
- secret leakage
- webhook forgery
- replayed webhook
- SSRF
- DNS rebinding
- malicious notebook
- output flooding
- resource exhaustion
- vulnerable legacy environment
- supply-chain substitution

## 62. Required controls

### Ingestion

- GitHub host/API allowlist
- API version pin
- bounded file count/size
- no arbitrary URL
- no archive extraction
- SHA-256 rehash
- quarantine
- content-type validation
- secret scan
- malware scan where applicable
- durable failure codes

### LLM

- untrusted data isolation
- no tools
- no secrets
- no network
- schema output
- evidence requirement
- token/file cap
- prompt/version capture

### Execution

- prebuilt images
- image digest pin
- non-root
- read-only root filesystem
- deny network
- no credentials
- CPU/memory/time/pid/output cap
- immutable input mount
- ephemeral writable temp
- no Docker socket
- no host mount
- no package install

### Legacy profiles

- never connect to network
- never receive secrets
- block if critical unmitigated vulnerability affects isolation
- preserve metadata even if execution is blocked

## 63. Failure codes

```text
repository_not_found
repository_private
ref_not_found
snapshot_too_large
manifest_truncated
file_too_large
aggregate_limit_exceeded
unsupported_binary
malformed_encoding
license_unknown
license_conflict
citation_conflict
metadata_conflict
prompt_injection_suspected
dependency_resolution_failed
wheel_unavailable
image_build_failed
security_scan_blocked
import_failed
example_failed
numerical_mismatch
semantic_drift
unsupported_capability
runtime_timeout
runtime_oom
output_limit_exceeded
inconclusive
```

## 64. Observability

metrics:

```text
import_job_latency
snapshot_fetch_bytes
fetch_rejections
extraction_assertions_per_repo
human_correction_rate
candidate_acceptance_rate
dependency_resolution_success
image_build_success
compatibility_pass_rate
semantic_drift_rate
reproduction_success_rate
baseline_time_saved
```

logsへ含めない:

- tokens
- full URLs with query
- source secrets
- environment secrets
- unredacted webhook secret

---

# Part XIX. Rights and Licensing

## 65. License levels

```text
approved_for_redistribution
external_execution_only
metadata_only
permission_requested
unknown
conflicting
rejected
```

## 66. Rules

- Public GitHubだから再配布可能とは限らない。
- no-license Repositoryはmetadata/linkのみ。
- MIT/BSDはnoticeを保持。
- Apache-2.0はLICENSE/NOTICE/change notice/patent条項を確認。
- GPL系はMajorana MIT coreへcode copyしない。separate runtime/adapterを優先。
- dataset licenseはitem単位で確認。
- paper licenseとcode licenseを分ける。
- extracted metadataの事実部分とcopyrighted proseを分ける。
- READMEを長文転載しない。
- independent reimplementationをofficialと表示しない。

---

# Part XX. Academic Value

## 67. Platform自体の学術性

GitHub Wrapperだけでは低い。学術価値は、platformで実施する定量研究から生まれる。

## 68. Research Track A: Metadata Extraction Benchmark

研究問い:

> 異種VQE Repositoryから、再現に必要なscientific metadataをどこまで自動抽出できるか。

dataset:

- 100–300 Repository
- expert gold annotation
- field-level evidence location

metrics:

```text
precision
recall
F1
exact match
evidence locator accuracy
conflict detection recall
human correction time
coverage
```

ablation:

- declaration only
- AST only
- LLM only
- AST + LLM
- AST + LLM + paper
- human-assisted

## 69. Research Track B: Version Drift

問い:

> Qiskit/PennyLane/PySCFのversion変化がVQE scientific semanticsへ与える影響は何か。

測定:

- Hamiltonian digest
- pool membership
- ansatz parameter count
- final energy
- convergence
- circuit resources
- default behavior

## 70. Research Track C: Cross-framework Equivalence

問い:

> 同一ProblemSpecから生成したQiskit/PennyLane/OpenFermion表現は、convention差を考慮して同値か。

評価:

- exact equality
- permutation equivalence
- numerical equivalence
- failure taxonomy

## 71. Research Track D: Comparability Engine

expert comparisonをgold labelにする。

metrics:

- classification accuracy
- invalid comparison recall
- explanation completeness
- expert agreement
- false confidence rate

## 72. Research Track E: Longitudinal Reproducibility

定期的に、

- install success
- example success
- numerical match
- current migration success
- failure cause

を追跡する。

## 73. Research Track F: User Study

tasks:

1. baselineを探す
2. paper-associated commitを特定
3. LiHで比較可能な3手法を探す
4. resultの比較可能性を判断
5.自分のRepositoryを登録

metrics:

- completion time
- error rate
- confidence calibration
- System Usability Scale
- reuse intention
- citation intention

---

# Part XXI. Implementation Roadmap by Pull Request

以下は一つの巨大PRにしない。各PRは独立review・rollback可能にする。

## PR-00: Baseline and ADR freeze

### Purpose

実装前に設計境界を固定する。

### Add

```text
docs/adr/github-source-identity.md
docs/adr/scientific-runtime-profiles.md
docs/adr/metadata-assertion-evidence.md
docs/adr/vqe-capability-support.md
docs/adr/catalog-presentation-separation.md
```

### Acceptance

- Repository != Artifactを明記
- version lanesを明記
- control plane/runtime分離
- no dynamic installation
- assertion publication rule
- current security review signoff

### Rollback

docsのみ。

---

## PR-01: Catalog presentation payload separation

### Purpose

`ArtifactVersion.code`から表示用JSONを分離。

### DB

新規`catalog_entry_payloads`。

### Code

```text
services/api/src/majorana_api/orm.py
services/api/src/majorana_api/repos/catalog_read_model.py
services/api/src/majorana_api/repos/catalog.py
db/migrations/versions/<next>_catalog_entry_payloads.py
```

### Migration

- existing bootstrap JSONをpayloadへbackfill
- source bytesは保持
- read pathはnew table優先
- legacy fallbackは一時維持

### Tests

- old 283 records equivalence
- real code yields payload independently
- malformed payload fail closed
- list response size

### Rollback

new read flagをoff、legacy fallback。

---

## PR-02: Source blob and source graph foundation

### Add tables

```text
external_repositories
repository_snapshots
source_blobs
repository_snapshot_files
artifact_source_links
```

### Critical migration

`normalized_source_hash` global uniqueを即削除せず、重複caseを調査。将来的にcontent blob dedupへ移す。

### Tests

- same bytes / different provenance
- same Repository / different commits
- rename owner/name with stable repository ID
- fork relation

---

## PR-03: Import multi-output support

### Add

```text
import_item_outputs
extraction_candidates
```

### Compatibility

existing `resulting_artifact_id`をlegacyとして残す。

### Tests

- one import item → one snapshot → multiple candidates
- retry no duplicate candidates
- one candidate rejection does not rollback siblings

---

## PR-04: GitHub App read-only client

### Add package

```text
packages/py/github-source/
```

またはAPI connector module。

### Features

- repository metadata
- commit resolution
- tree retrieval
- selected content fetch
- ETag
- API version
- retry/backoff
- rate limit observation

### Security

- Contents read + Metadata read
- token redaction
- no arbitrary host
- no redirects to untrusted host

### Tests

- recorded fixture responses
- truncated tree
- renamed repo
- deleted ref
- rate limit
- 304
- oversized file

---

## PR-05: Quarantine fetch boundary

PR #66の内容を現在のADR・GitHub-specific architectureへ再設計して取り込む。

### Must not do

古いprivate httpx internals依存を無レビューで復活させない。

### Decide

- GitHub API clientだけで十分か
- generic fetcherを別serviceにするか
- subprocess isolationかmicroserviceか
- object storage quarantine

### Acceptance

- no DB credentials in fetcher
- SSRF tests
- DNS rebinding tests
- byte/time caps
- rehash pickup
- stable failure codes

---

## PR-06: Manual GitHub import

### Endpoint/CLI

operator CLIまたはinternal API。

Input:

```json
{
  "repository_url": "...",
  "requested_ref": "...",
  "paper": {"arxiv_id": "..."}
}
```

### Output

- import job
- snapshot
- selected files
- no public Artifact yet

### Tests

- idempotency
- same commit repeat
- ref drift
- private repo rejection
- no license

---

## PR-07: Extraction ledger

### Add tables

```text
metadata_extraction_runs
metadata_assertions
assertion_conflicts
```

### Add deterministic parsers

- CITATION.cff
- pyproject
- requirements
- environment.yml
- Dockerfile metadata
- GitHub Actions
- README links

### No LLM yet

deterministic extraction qualityを先に測る。

---

## PR-08: Python AST extractor

### Add package

```text
packages/py/research-extraction/
```

### Detect

- imports
- aliases
- constructors
- call keywords
- literal config
- CLI entrypoints

### Tests

fixture corpus:

- Qiskit VQE
- PennyLane qchem
- OpenVQE
- Tangelo
- misleading imports
- unused dependency

---

## PR-09: Notebook sanitizer/extractor

### Requirements

- no execution
- outputs removed
- cell index evidence
- max cells/tokens
- HTML sanitized
- attachments rejected

---

## PR-10: LLM assisted extraction

### Restrictions

- no tools
- no network
- no DB writes
- schema output
- evidence locator required
- prompt/model version stored
- raw source budget

### Evaluation

gold fixture precision/recall before enabling in production.

---

## PR-11: Review UI and author claim

### Review actions

- accept assertion
- correct value
- mark ambiguous
- reject candidate
- merge duplicate candidate
- mark official relation
- request author confirmation

### Audit

append-only correction.

---

## PR-12: VQE schema v0.1

### Add package

```text
packages/py/vqe-schema/
```

### Models

```text
VQESpec
ProblemSpec
RepresentationSpec
AnsatzSpec
OperatorPoolSpec
AdaptiveSearchSpec
OptimizerSpec
MeasurementSpec
CompilationSpec
RuntimeRequirementSpec
```

### Rule

no imports from Qiskit/PennyLane/API.

---

## PR-13: VQE DB extension and facets

### Add

```text
vqe_specs
vqe_spec_facets
software_packages
provider_releases
artifact_package_bindings
```

### Indexes

- method family
- molecule
- basis
- mapping
- optimizer
- package
- evidence level

---

## PR-14: Server-side search and pagination

### Replace

all-record client fetch.

### Add

cursor pagination、typed filters、query plan tests。

### Performance acceptance

- 100k entries synthetic test
- p95 list query targetを定義
- response payload cap

---

## PR-15: Runtime profile registry

### Add

```text
runtime_profiles
runtime_profile_packages
adapter_releases
capability_definitions
capability_support
```

### No execution yet

registry and UI only。

---

## PR-16: Qiskit VQE runtime candidate

### Create

```text
runtimes/vqe/qiskit-current/
packages/py/vqe-adapters-qiskit/
```

### Tests

Tier A+B。

### Promotion gate

candidate remains non-public until golden review。

---

## PR-17: PennyLane VQE runtime candidate

同様。

### Special checks

- QNode expval vs readout measurement
- tape/resource semantics
- wire order
- differentiator
- dataset-free execution

---

## PR-18: Cross-framework canonical Hamiltonian

### Add

- canonical operator representation
- permutation equivalence
- tolerance protocol
- H2/LiH corpus

### Academic artifact

first publishable benchmark component。

---

## PR-19: Dataset providers

### HamLib

selected instances only。

### PennyLane Datasets

snapshot hashes, attributes, license metadata。

### No runtime network

pre-fetch through importer。

---

## PR-20: QuantMark protocol crosswalk

### Add

- protocol version
- metric mapping
- limitations
- paper-derived evidence

### Review

VQE expert signoff。

---

## PR-21: Compatibility runner

### Add

- execution broker
- profile selection
- isolated runtime invocation
- normalized failure states
- evidence storage

### No claim reproduction yet

install/import/example only。

---

## PR-22: Semantic drift pipeline

### Add

- base/candidate profile comparison
- drift taxonomy
- promotion gate
- UI diff

---

## PR-23: Tangelo selected profile

one version, one backend, one example。

---

## PR-24: OpenVQE legacy profile

one paper-associated commit, Linux CPU, selected example。

---

## PR-25: CUDA-QX CPU profile

small VQE/ADAPT, no GPU。

---

## PR-26: Comparability engine

### Input

two structured ExperimentSpecs。

### Output

classification + dimension diff + unknowns。

### Evaluation

expert-labeled pairs。

---

## PR-27: Claim-level reproduction

### Add

```text
scientific_claims
reproduction_attempts
claim_evidence_links
metric_observations
```

### First target

5–10 high-value VQE/ADAPT claims。

---

## PR-28: CUDA-QX GPU optional execution

separate infrastructure review、quota、cost controls。

---

# Part XXII. AI Agent Execution Protocol

## 74. Agent preflight before every PR

Agentは必ず以下を実行する。

1. current dateを記録。
2. `dev`の最新commit SHAを取得。
3. relevant `AGENTS.md`を読む。
4. current migration headを確認。
5. open PRとconflict areaを確認。
6. target filesを列挙。
7. blast-radius filesを識別。
8. official external docsを再確認。
9. assumptionsを`ASSUMPTIONS.md`またはPR bodyに明記。
10. scope外変更を禁止。

## 75. Database change protocol

1. temporary Neon branchを作る。
2. current headからmigrationを生成。
3. up migration。
4. fixture/data backfill。
5. application tests。
6. downgrade。
7.再upgrade。
8. row count/invariant確認。
9. production migrationを直接試さない。
10. actual migration numberをcurrent headから決め、本文の番号を盲目的に使わない。

## 76. External version protocol

Agentは禁止:

- memoryだけでversionを決める。
- `latest`をdependencyに書く。
- broad rangeをruntime保証に使う。
- release notesを読まずupgradeする。

Agent必須:

1. official package registryを確認。
2. official release notesを確認。
3. Python/platform constraintを確認。
4. licenseを確認。
5. wheel availabilityを確認。
6. release artifact hash/attestationを保存。
7. isolated resolverを実行。
8. lockをcommit。
9. golden test。
10. capability supportを更新。

## 77. Pull Request Definition of Done

各PRは以下を満たす。

- scope説明
- threat impact
- migration impact
- API contract impact
- tests
- rollback
- docs
- no secrets
- generated contract check
- lint/typecheck
- relevant live/temporary Neon test
- no silent fallback
- evidence claims are not overstated
- exact commit/profile references

## 78. Stop conditions

Agentは以下で停止してhuman decisionを要求する。

- license conflict
- security boundary change
- publication authority change
- external code execution with network
- credentials required
- schema destructive migration
- unsupported scientific ambiguity that changes result meaning
- official implementation relation is uncertain
- major semantic drift
- package source must compile unreviewed native code

それ以外の通常実装詳細では、合理的な既定値を選びPRに明記する。

---

# Part XXIII. Validation and Go/No-Go

## 79. MVP corpus

20–50 Repository。

内訳:

```text
VQE/UCCSD
ADAPT-VQE
Qubit-ADAPT
QEB-ADAPT
TETRIS-ADAPT
CEO-ADAPT
measurement reduction
pruning/compression
learning-guided VQE
```

## 80. Product Go criteria

- 80%以上で固定commit取得
- 70%以上でpaper relation特定
- 60%以上でenvironmentの主要情報取得
- human review時間が手作業登録より50%以上短縮
- researcher task completion timeが既存workflowより明確に短縮
- metadata conflictを隠さず表示
-少なくとも10件でinstall status
-少なくとも5件でnumerical verification
-少なくとも3件でclaim reproduction

## 81. Engineering Go criteria

- network importer threat review完了
- arbitrary URL禁止
- import idempotency
- 100k-entry scale query test
- isolated runtime no-network
- image/SBOM/digest
- rollback tested
- public data last-known-good cache
- no dependency leakage into API/Worker image

## 82. Academic Go criteria

- expert-annotated gold corpus
- extraction baseline
- reproducible evaluation scripts
- error taxonomy
- pre-registered or fixed evaluation protocol
- negative results preserved
- human expert agreement measured

---

# Part XXIV. Initial Concrete Support Matrix

## 83. Qiskit profile v1 target

| Capability | Initial state |
|---|---|
| PySCFDriver | target verified |
| ElectronicStructureProblem | target verified |
| FreezeCoreTransformer | target verified |
| ActiveSpaceTransformer | target verified |
| JordanWignerMapper | target verified |
| ParityMapper | target verified |
| HartreeFock | target verified |
| UCCSD | target verified |
| VQE exact | target verified |
| VQE finite shots/Aer | target experimental |
| AdaptVQE small pool | target experimental |
| QEOM | unsupported |
| QPU | unsupported in v1 |
| Vibrational | unsupported |

## 84. PennyLane profile v1 target

| Capability | Initial state |
|---|---|
| qchem Molecule | target verified |
| molecular_hamiltonian | target verified |
| HF state | target verified |
| excitations | target verified |
| UCCSD | target verified |
| default.qubit exact | target verified |
| finite shots | target verified |
| Autograd | target verified |
| JAX | experimental |
| Torch | experimental |
| Catalyst | unsupported |
| external hardware | unsupported |

## 85. Non-native initial support

| Provider | Indexed | Structured | Executable |
|---|---:|---:|---:|
| OpenFermion | yes | operator/problem | adapter-level only |
| PySCF | yes | driver/config | through selected profiles |
| HamLib | yes | dataset/problem | no direct runtime |
| PennyLane Datasets | yes | dataset/problem | no direct runtime |
| QuantMark | yes | protocol/metric | no |
| Tangelo | yes | basic workflow | later isolated |
| OpenVQE | yes | method/package | later legacy |
| CUDA-QX | yes | method/capability | later CPU/GPU |

---

# Part XXV. Official Source Registry for Agents

Agentは外部事実を更新するとき、以下のofficial sourceを優先する。

## GitHub

```text
docs.github.com/en/rest/about-the-rest-api/api-versions
docs.github.com/en/rest/git/trees
docs.github.com/en/rest/repos/contents
docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions
docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
```

## uv / Python packaging

```text
docs.astral.sh/uv/concepts/projects/sync
docs.astral.sh/uv/concepts/projects/export
docs.astral.sh/uv/reference/cli
packaging.python.org/en/latest/specifications/pylock-toml
```

## Qiskit

```text
pypi.org/project/qiskit
pypi.org/project/qiskit-aer
pypi.org/project/qiskit-nature
pypi.org/project/qiskit-algorithms
qiskit-community.github.io/qiskit-nature/release_notes.html
qiskit-community.github.io/qiskit-algorithms/release_notes.html
qiskit-community.github.io/qiskit-nature/getting_started.html
```

## PennyLane

```text
pypi.org/project/pennylane
docs.pennylane.ai/en/stable/development/release_notes.html
docs.pennylane.ai/en/stable/introduction/chemistry.html
docs.pennylane.ai/en/stable/introduction/data.html
```

## OpenFermion / PySCF

```text
pypi.org/project/openfermion
quantumai.google/reference/python/openfermion
pypi.org/project/pyscf
pyscf.org/install.html
```

## Tangelo

```text
pypi.org/project/tangelo-gc
sandbox-quantum.github.io/Tangelo
github.com/sandbox-quantum/Tangelo
```

## OpenVQE

```text
github.com/OpenVQE/OpenVQE
```

## CUDA-QX

```text
nvidia.github.io/cudaqx/components/solvers/introduction.html
nvidia.github.io/cudaqx/quickstart/installation.html
pypi.org/project/cudaq-solvers
```

## HamLib / QuantMark

```text
Quantum journal HamLib paper
PennyLane Datasets HamLib collection
IEEE TQE QuantMark publication page
```

---

# Part XXVI. Immediate Next Actions

順序を変更しない。

1. PR-00 ADRを作る。
2. PR-01 presentation payloadを分離する。
3. PR-02 source graphを追加する。
4. PR-03 import multi-outputを追加する。
5. PR-04 GitHub App read-only clientを作る。
6. PR-05 fetch/quarantine security boundaryを承認・実装する。
7. PR-06 manual metadata-only importを完成する。
8. 20件のVQE corpusを取り込む。
9. deterministic extractionの精度を測る。
10. LLM extractionはその後に追加する。
11. VQE schema v0.1をcorpusから確定する。
12. Qiskit/PennyLane runtime profileをcontrol planeと別projectで作る。
13. golden testsを通してからsupport badgeを付ける。
14. datasets/protocolを追加する。
15. Tangelo/OpenVQE/CUDA-QXは、需要とcorpusに基づき一件ずつisolated executionを追加する。
16. comparability engineとclaim reproductionへ進む。

---

# 最終原則

1. **Repository数ではなく、研究者の時間短縮を最適化する。**
2. **最新対応と論文再現を同じlaneにしない。**
3. **Framework対応ではなくCapability対応を宣言する。**
4. **自動抽出はassertionであり、確認済み事実ではない。**
5. **未知・曖昧・矛盾を消さず、研究情報として保存する。**
6. **外部scientific runtimeをcontrol planeへ混ぜない。**
7. **同じcodeでもprovenanceを保持する。**
8. **実行成功と科学的正しさを分ける。**
9. **学術価値は統合数ではなく、抽出・drift・比較・再現の定量評価から作る。**
10. **すべてのsupport claimは、version・runtime・capability・evidenceへ紐づける。**

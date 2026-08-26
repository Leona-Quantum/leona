# Runbook: rebuilding and publishing the `majorana-runner` sandbox image

`infra/sandbox/Dockerfile` is the root filesystem that untrusted, LLM-generated
quantum code executes in. **Nothing publishes it automatically, and nothing in CI
publishes it at all** — `sandbox-image.yml` builds and exercises it on every PR that
touches it and rebuilds-and-scans it weekly, but the push comes from a laptop, by
step 1 below. Until 2026-08-06 the procedure existed
nowhere at all: the only trace in the repo was a comment in
`packages/py/sandbox/src/majorana_sandbox/vercel.py` saying the image is
"built + scanned weekly". This file is that procedure.

**The failure this closes.** PR #262 added five packages to the Dockerfile
(`amazon-braket-sdk`, `amazon-braket-default-simulator`, `numba`, `qibo`,
`qulacs`) and shipped the Braket/Qibo/Qulacs agent lanes to production. The lanes
were live and inert for a day: the image was not rebuilt, so every run in one of
the three new frameworks failed with `ModuleNotFoundError` inside the sandbox.
A merged Dockerfile change is not a shipped Dockerfile change.

## THE STUDIO COMPILER LANE NOW DEPENDS ON THIS IMAGE — promote before you merge

Added by ai-ops#186, answered *option A*. `infra/sandbox/Dockerfile` gained
`pytket`, `pyzx` and `bqskit`, and Studio's circuit-compression lane runs
`majorana_frameworks/optimizer_kernel.py` inside this rootfs through
`majorana_sandbox.run_trusted` — so those six compilers stopped being installed
in the api+worker image entirely. Measured with one method
(`uv export --no-dev --all-packages`): 121 packages in that credentialed image
with the compilers in a runtime extra, **87 without — which is exactly what
`dev` resolved to before the lane existed.** The lane now adds nothing to the
process that holds the credentials.

**What that buys you also buys an ordering hazard, and it is #262's.** A merge
does not move `latest`; step 5 below does. So a PR that lands the compiler lane
before the image is promoted ships a feature whose SDKs are not there. Three
things bound how bad that is, in decreasing order of how much you should rely on
them:

1. **Do the promotion first.** The Dockerfile change and the code change ride in
   one PR, and `sandbox-image.yml`'s `build` job compiles a real circuit through
   all six compilers inside the image that PR produces — so a green check is
   evidence the image *would* work, not that the published one does. Promote the
   dated tag before merging the code, not after.
2. The kernel maps `ImportError` to **`compiler_unavailable`** and the worker
   surfaces it as a typed refusal — "The bqskit compiler is not installed in this
   sandbox image." That is a legible failure, not a working feature.
3. Nothing else in the product regresses: the lane is a separate run kind, and
   the execution lane's frameworks were already in this image.

Step 4's verification should now run a compile as well as a Bell pair. The
command is in `sandbox-image.yml`'s "every Studio compiler compiles a real
circuit" step; point it at the dated tag instead of `majorana-runner:ci`.

## What the image is, and where it is referenced

| | |
|---|---|
| Source | `infra/sandbox/Dockerfile` (no build context is copied — the image installs wheels and nothing else) |
| Registry | Vercel Container Registry (VCR), `vcr.vercel.com` |
| Full reference | `vcr.vercel.com/majoranaq/web/majorana-runner:<tag>` |
| Referenced by | `packages/py/sandbox/src/majorana_sandbox/vercel.py` — `DEFAULT_IMAGE = "majorana-runner"`, i.e. the **`latest`** tag |
| Vercel project | `web` — `prj_AtHnlVhlFc1mFNyAb3RvlET2NtBh` (team `majoranaq`, `team_DRpA2jUgcqzPCQ24jjjOLN0O`) |

A VCR repository belongs to one Vercel project, and Sandbox resolves a bare
repository name against the project it is authenticated for. Those are the same
project the worker uses: `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` are plain env on
the `majorana-worker` Cloud Run service, so `gcloud run services describe
majorana-worker --region us-west1 --format='yaml(spec.template.spec.containers[0].env)'`
is the authority if these ids ever look wrong.

**`linux/amd64` is not optional.** VCR only serves an image to Sandbox once it has
prepared an optimised `linux/amd64` build; anything else is published with status
`Unoptimized` and `Sandbox.create()` refuses it. On an Apple-silicon machine that
means `--platform linux/amd64` and an emulated build. The Dockerfile installs
`--only-binary=:all:`, so nothing compiles — the emulation cost is unpacking, not
building, and the whole thing takes a few minutes.

## The procedure

### 1. Authenticate Docker to VCR

`vercel vcr login` mints a short-lived, project-scoped OIDC token (12 h) and hands
it to Docker. **It needs a recent CLI — 54.21.1 does not have the subcommand.**
Run it without touching the globally installed CLI:

```bash
npx -y vercel@58.7.1 vcr login docker --project prj_AtHnlVhlFc1mFNyAb3RvlET2NtBh --scope majoranaq
```

Confirm it landed (the credential goes to the Docker credential store, so
`auths` carries the host with no inline secret):

```bash
python3 -c "import json;print(list(json.load(open('$HOME/.docker/config.json'))['auths']))"
```

The token path is the fallback, and it is what CI would use — the username is the
**team id**, not a username:

```bash
printf '%s' "$VERCEL_TOKEN" | docker login vcr.vercel.com --username "$VERCEL_TEAM_ID" --password-stdin
```

### 2. Build and push a dated tag — never straight to `latest`

**Set `TAG` once and keep the shell**, because steps 2, 4 and 5 must name the same
image. Verifying one tag and promoting another is a silent way to ship an unverified
rootfs, and the two commands look identical while doing it.

```bash
TAG="$(date -u +%F)"
docker buildx build --platform linux/amd64 --progress plain \
  --output "type=image,name=vcr.vercel.com/majoranaq/web/majorana-runner:$TAG,push=true,oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true" \
  infra/sandbox
```

Push a dated tag first because **`latest` is production**: `DEFAULT_IMAGE` has no
tag, so the moment `latest` moves, every sandbox the worker creates boots the new
rootfs. The dated tag is what you verify against, and what you roll back to.

**A first-attempt `DeadlineExceeded: context deadline exceeded` on
`[internal] load metadata for docker.io/library/python...` is transient and was
seen on 2026-08-06.** The daemon's registry path can time out while container
egress and the host both reach Docker Hub fine. Re-run the same command; it
resolved on the second attempt.

### 3. Wait for VCR to prepare the image

```bash
vercel vcr image ls majorana-runner --project prj_AtHnlVhlFc1mFNyAb3RvlET2NtBh --scope majoranaq
```

The row for the new `amd64` image must read `Ready`. While it reads `Preparing`,
`Sandbox.create()` returns `image_not_ready`. On 2026-08-06 the 314 MB image read
`Preparing` 11 seconds after the push and `Ready` when next checked 11 minutes
later — the true duration is somewhere in between and was not measured. Poll;
do not budget from that range.

### 4. Verify the dated tag in a real sandbox, under deny-all

This is the step that would have caught #262. Run it against the **dated tag**,
before promoting, and with the production network policy — `deny-all` also proves
the packages are baked into the rootfs rather than being fetched at runtime:

```bash
npx -y vercel@58.7.1 sandbox run --image "majorana-runner:$TAG" \
  --network-policy deny-all --rm \
  --project prj_AtHnlVhlFc1mFNyAb3RvlET2NtBh --scope majoranaq \
  -- python -c "import qiskit, qiskit_aer, pennylane, cirq, braket, numba, qibo, qulacs; print('ok')"
```

An import is the floor, not the bar — import the module *and* run something. The
2026-08-06 rebuild ran a Bell pair on all three new frameworks: Braket
`{'00': 51, '11': 49}`, Qibo `{'00': 57, '11': 43}`, Qulacs
`[0.5, 0.0, 0.0, 0.5]`. `qulacs` in particular imports fine and would still fail
on a bad wheel/ABI pairing at first use.

### 5. Promote to `latest`

Copy the manifest rather than rebuilding, so `latest` and the dated tag are
provably the same bytes:

```bash
docker buildx imagetools create \
  --tag vcr.vercel.com/majoranaq/web/majorana-runner:latest \
  "vcr.vercel.com/majoranaq/web/majorana-runner:$TAG"
```

Then confirm the tag production actually resolves — the bare name, exactly as
`DEFAULT_IMAGE` uses it:

```bash
npx -y vercel@58.7.1 sandbox run --image majorana-runner --network-policy deny-all --rm \
  --project prj_AtHnlVhlFc1mFNyAb3RvlET2NtBh --scope majoranaq \
  -- python -c "import braket, qibo, qulacs, numba; print('ok')"
```

No API or worker redeploy is needed. `DEFAULT_IMAGE` is a constant that names a
tag, so moving the tag *is* the deploy — which is also why step 4 comes before
step 5 and not after.

### Rollback

One command, and it is the same mechanism as promotion:

```bash
docker buildx imagetools create \
  --tag vcr.vercel.com/majoranaq/web/majorana-runner:latest \
  vcr.vercel.com/majoranaq/web/majorana-runner@sha256:<previous-index-digest>
```

`vercel vcr image ls majorana-runner …` lists every image with its digest and age;
the pre-#262 index was `sha256:6f1c0578ac2c895c1f007d3b981504b4379502161212d9876a5774210bb149d7`
(214.4 MB, published 2026-07-14). **Never delete the previous image** — the
digest is the rollback.

## The base image is pinned by digest, deliberately

`FROM python:3.13-slim-bookworm@sha256:9d7f28…` — the tag alongside it is a
comment, not the pin. `python:3.13-slim-bookworm` is republished on every patch
release, which would make the one input to the isolation boundary something a
third party can change without any diff here. Re-resolving that digest is a
deliberate edit with a reviewable diff. See the header comment in the Dockerfile.

## Two things measured on 2026-08-06, both worth knowing before editing the Dockerfile

**Sandbox runs this image as `root`.** The Dockerfile suppresses
`dockerfile.security.missing-user` as UNRESOLVED rather than answered, and asks
for a `run_command("id")` probe against the real image before anything changes.
The probe has now been run: `uid=0(root) gid=0(root) groups=0(root)`, with
`os.getcwd()` reporting `/tmp/run`, so **`WORKDIR` is honoured and no `USER` is
imposed by the platform**. That answers the "can we even see it" half. Whether a
non-root `USER` survives the SDK's write of `main.py` into `/tmp/run` is still
untested and remains the open half.

**The image is 314.3 MB after #262, up from 214.4 MB.** Five packages, +100 MB.
`numba` is a `qibo` dependency rather than a framework anyone selects.

## Why there is still no CI job that publishes this

There is now a CI job that **builds the image and exercises it**
(`.github/workflows/sandbox-image.yml`, path-filtered to `infra/sandbox/**`): it
imports all six frameworks and runs a Bell pair on each, with `--network none` so a
package missing from the rootfs fails there rather than in a deny-all sandbox. So a
Dockerfile that cannot build — or that builds and cannot run a circuit — fails the PR
instead of failing in production a day later. Publishing stays manual and stays in this
runbook: `latest` is the live sandbox rootfs for
untrusted code, an automatic push on merge would move it before anyone verified
it, and step 4 above — run a circuit, do not just import — is not a step a merge
event can decide is unnecessary.

**There was a `publish` job here until 2026-08-16, and it had never worked.** It read
`VERCEL_TOKEN` and `VERCEL_TEAM_ID` from repository secrets that were never set, so
`docker login` ran with empty values and died on `Must provide --username with
--password-stdin` — an error that never names a secret. No one noticed because
nothing ever dispatched it; the only run in the repo's history is the one that found
it. Deleted rather than fixed (owner ruling, ai-ops#118): step 1's
`vercel vcr login docker` mints a short-lived OIDC token on demand, which is a
better credential than a long-lived registry token living in CI, and a second
route to moving `latest` is a liability rather than a convenience.

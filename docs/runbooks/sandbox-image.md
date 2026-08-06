# Runbook: rebuilding and publishing the `majorana-runner` sandbox image

`infra/sandbox/Dockerfile` is the root filesystem that untrusted, LLM-generated
quantum code executes in. **Nothing publishes it automatically** — `sandbox-image.yml`
builds and exercises it on every PR that touches it, and publishes only when a human
dispatches the workflow, to a dated tag. Until 2026-08-06 the procedure existed
nowhere at all: the only trace in the repo was a comment in
`packages/py/sandbox/src/majorana_sandbox/vercel.py` saying the image is
"built + scanned weekly". This file is that procedure.

**The failure this closes.** PR #262 added five packages to the Dockerfile
(`amazon-braket-sdk`, `amazon-braket-default-simulator`, `numba`, `qibo`,
`qulacs`) and shipped the Braket/Qibo/Qulacs agent lanes to production. The lanes
were live and inert for a day: the image was not rebuilt, so every run in one of
the three new frameworks failed with `ModuleNotFoundError` inside the sandbox.
A merged Dockerfile change is not a shipped Dockerfile change.

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
`Sandbox.create()` returns `image_not_ready`. Preparation took a few minutes for
the 314 MB image on 2026-08-06.

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
instead of failing in production a day later. Publishing stays manual and stays behind
`workflow_dispatch`: `latest` is the live sandbox rootfs for
untrusted code, an automatic push on merge would move it before anyone verified
it, and step 4 above — run a circuit, do not just import — is not a step a merge
event can decide is unnecessary.

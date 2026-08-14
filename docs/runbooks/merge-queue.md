# Enabling the merge queue on `dev`

This is the "turn it on" checklist for after the org transfer (ai-ops#46/#70:
`EshMis/majorana` → an organization-owned repo). GitHub merge queues require an
**organization**-owned repository — that is the reason the transfer exists — so
none of this can be switched on before it lands, and this runbook does not switch
it on. It only records what to flip once the repo is on the other side.

The prerequisite work — giving every required-check workflow a `merge_group`
trigger, and making `blast-radius` behave correctly under that event — landed
separately (ai-ops#46/#70, merge-queue-prerequisites lane) and needs no further
action here. What's left is entirely branch-protection configuration.

> [!IMPORTANT]
> **The first thing to do the first time the queue actually runs is confirm
> `blast-radius` ran, not that the queue went green.** Before this PR, `blast-radius`
> had no `merge_group` trigger at all; under that event its `if:` evaluated false,
> the job was **skipped**, and a skipped required check reports success. A queue
> that merges every PR without that gate ever executing looks *identical* — green,
> fast, no errors — to a queue where the gate is doing its job. The `blast-radius`
> job's own `merge_group` code path (the part that recovers the PR number from
> `head_ref` and re-fetches the body over the API) was verified by direct
> simulation against a real historical diff and against GitHub's documented
> payload shape, not by an actual `merge_group`-triggered run — the queue can't be
> switched on until this transfer lands, so no real `merge_group` event has ever
> reached this job. Step 4 below is not optional the first time; do not skip
> straight to "it merged, done."

## 1. Confirm the required checks survived the transfer

Repo transfers normally carry branch protection over, but confirm it rather than
assume it:

```
gh api repos/<ORG>/<REPO>/branches/dev/protection --jq '.required_status_checks'
```

Expect `strict: true` and the same eight contexts: `ts`, `py`, `db`, `gitleaks`,
`osv`, `semgrep`, `client-bundle`, `blast-radius`. If any are missing, restore
them before touching the queue settings below — the queue re-validates whatever
is in this list, not some separate list of its own.

## 2. Turn off "Require branches to be up to date before merging" (`strict`)

**What I could confirm and what I could not, from GitHub's own current docs**
(`github/docs`, `reusables/pull_requests/merge-queue-overview.md`, fetched
2026-08-15): *"The merge queue provides the same benefits as the **Require
branches to be up to date before merging** branch protection, but does not
require a pull request author to update their pull request branch."* That is the
only sentence GitHub's docs currently say about the interaction. I could **not**
find any statement that leaving `strict` on causes an error, a rejection, or
GitHub refusing the configuration — that stronger claim doesn't appear to be
accurate as written and shouldn't be repeated as fact. What is true: the merge
queue re-tests every PR against a fresh trial merge of the current base before
merging it, which is a strict superset of what `strict` checks, so leaving
`strict` on afterward is redundant, not protective. Turn it off:

```
Settings → Branches → dev → Edit → uncheck
"Require branches to be up to date before merging"
```

or via API: set `strict: false` in the same `required_status_checks` object read
in step 1, leaving the `contexts` list untouched.

## 3. Enable "Require merge queue"

`Settings → Branches → dev → Edit → check "Require merge queue"`. This is the
actual on-switch; everything before this point is prerequisite.

Configure, in the same panel:

### 3a. Set the queue's merge method to squash — with a verification, not just a click

`AGENTS.md` states "squash merge only" as a hard branching rule for this repo,
enforced today by the repo's `allow_squash_merge`/`allow_merge_commit`/
`allow_rebase_merge` settings. **The merge queue's "Merge method" dropdown is a
separate setting that does not inherit those** — it is entirely possible to
finish step 3 with the queue live and merging clean fast-forwards or merge
commits into `dev` while the repo-level settings still say squash-only, and
nothing will flag the mismatch: the PR merges, the checks are green, `dev`
moves. The discrepancy only becomes visible in `git log`, by which point the
non-squash commits are already in production history.

1. In the "Require merge queue" panel, set **Merge method: Squash**.
2. Immediately after the first PR merges through the queue, verify the commit
   that landed is actually a squash commit, not a merge commit or a
   fast-forwarded set of the PR's original commits:

   ```
   git log --oneline -1 origin/dev          # exactly one new commit, not N
   git log --format='%P' -1 origin/dev | wc -w   # 1 parent, not 2 (a 2-parent
                                                  # commit is a merge commit —
                                                  # the queue picked the wrong method)
   ```

3. If either check fails, fix the queue's Merge method setting immediately —
   every PR merged before the fix has already written the wrong kind of commit
   into `dev`'s permanent history, and that cannot be rewritten after the fact
   without rewriting production history.

### 3b. Other settings in the same panel

- **Only merge non-failing pull requests: recommend Yes (enabled).** With it off,
  a PR that fails a required check can still ride into a batch as long as the
  *last* PR in the group passes — useful for flaky tests, but this repo has
  already had two required checks go silently unenforceable from looser
  configurations (`snyk`, and `CODEOWNERS` review — see
  `scripts/check-blast-radius.mjs`'s header). Leave this on unless a specific
  flakiness problem shows up later; it's an ops default, not a product decision,
  so an owner override at any point is fine.
- **Build concurrency / merge limits:** defaults (1 minimum, low concurrency) are
  fine to start given current PR volume; revisit only if the queue is visibly
  slow.

## 4. Verify a PR actually went through the queue, not around it

Once this is on, "merged to `dev`" no longer implies "went through the queue" by
itself — an admin bypass or a misconfigured protection rule could still land a
direct merge. Two independent signals, check both:

1. **The PR timeline.** A queued PR shows an explicit
   "*added this pull request to the merge queue*" event (and, on removal/failure,
   a corresponding removal event) between the last review and the merge. A direct
   merge has no such event. `gh pr view <N> --json timelineItems` surfaces these
   as `AddedToMergeQueueEvent` / `RemovedFromMergeQueueEvent` entries in the
   GraphQL timeline; the web UI shows them inline.
2. **The check runs' event type — check all eight by name, not just that the PR
   shows green.** This is the check that actually catches the skip case above:
   a job that silently skips under `merge_group` still reports a conclusion (
   `skipped`), a skipped required check still counts as passing, and the PR still
   shows all-green. The only way to tell "ran and passed" from "silently skipped"
   is to look at each job individually:

   ```
   gh run list --workflow ci.yml --json event,headBranch,conclusion,createdAt \
     | jq '[.[] | select(.event=="merge_group")]'
   gh run list --workflow security.yml --json event,headBranch,conclusion,createdAt \
     | jq '[.[] | select(.event=="merge_group")]'
   ```

   The `headBranch` for these runs will be `gh-readonly-queue/dev/pr-<N>-<sha>`.
   For each of `ts`, `py`, `db`, `gitleaks`, `osv`, `semgrep`, `client-bundle`,
   `blast-radius`, confirm the job's own conclusion in that run is
   `success` — not `skipped`, and not just "the workflow run overall succeeded."
   If a merged PR has no `merge_group` run at all, it did not go through the
   queue; if it has one but a job inside it shows `skipped`, the queue ran but
   that gate did not.

## What NOT to assume

- Don't assume the eight required contexts are the only checks that matter for a
  given PR — `ui-visual` (ci.yml) and the sandbox/live-llm/bench workflows are
  intentionally not required and don't need `merge_group` triggers; adding one to
  a non-required workflow only adds load, not safety.
- Don't re-enable `strict` "just to be safe" once the queue is on — see §2. It
  doesn't add protection and does reintroduce the exact wait-for-rebase friction
  the queue exists to remove.

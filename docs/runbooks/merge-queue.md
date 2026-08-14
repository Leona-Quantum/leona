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

- **Merge method: squash.** `AGENTS.md` states "squash merge only" as a hard
  branching rule for this repo — the queue's merge method is a separate setting
  from the repo-level default and does not inherit it, so this has to be set
  explicitly or the queue will pick a different method.
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
2. **The check runs' event type.** Every one of the eight required checks should
   have a second run whose `event` is `merge_group`, not just the original
   `pull_request` run:

   ```
   gh run list --workflow ci.yml --json event,headBranch,conclusion,createdAt \
     | jq '[.[] | select(.event=="merge_group")]'
   ```

   The `headBranch` for that run will be `gh-readonly-queue/dev/pr-<N>-<sha>`. If
   a merged PR has no `merge_group` run at all, it did not go through the queue.

## What NOT to assume

- Don't assume the eight required contexts are the only checks that matter for a
  given PR — `ui-visual` (ci.yml) and the sandbox/live-llm/bench workflows are
  intentionally not required and don't need `merge_group` triggers; adding one to
  a non-required workflow only adds load, not safety.
- Don't re-enable `strict` "just to be safe" once the queue is on — see §2. It
  doesn't add protection and does reintroduce the exact wait-for-rebase friction
  the queue exists to remove.

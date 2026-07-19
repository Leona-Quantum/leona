"""Choosing what to show a user whose run ran out of budget.

The agent loop pays for up to four candidates, never ranks them against each
other, and until 2026-07-20 returned *nothing* when the budget ran out — the
worst possible output for someone who waited. It has candidates; it just threw
them away.

This module is the ranking, kept pure so it can be tested without a database.
What it does NOT do is relax any gate: the winner is never published, never
enters the Vault, and the run still ends `failed`. It is evidence of the best
attempt, not a result.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from majorana_agent import CandidateRevision, VerificationEvidence

# Ordered worst-last. A candidate whose critic never rendered a verdict sorts
# below one that did: absent evidence is not mild evidence.
_SEVERITY_RANK = {"none": 0, "minor": 1, "major": 2, "blocking": 3}
_UNKNOWN_SEVERITY = len(_SEVERITY_RANK)


@dataclass(frozen=True)
class BestEffort:
    candidate: CandidateRevision
    verification: VerificationEvidence | None
    candidates_considered: int

    @property
    def failed_checks(self) -> list[str]:
        if self.verification is None:
            return []
        return [
            str(check.get("method"))
            for check in self.verification.deterministic_checks
            if check.get("result") != "pass"
        ]

    @property
    def critic_summary(self) -> str | None:
        critic = self._critic
        summary = critic.get("summary") if critic else None
        return str(summary)[:2000] if summary else None

    @property
    def residual_risks(self) -> list[str]:
        critic = self._critic
        risks = critic.get("residual_risks") if critic else None
        return [str(item)[:1000] for item in risks][:20] if isinstance(risks, list) else []

    @property
    def _critic(self) -> dict[str, Any] | None:
        if self.verification is None or not isinstance(self.verification.critic, dict):
            return None
        return self.verification.critic


def _rank(
    candidate: CandidateRevision, verification: VerificationEvidence | None
) -> tuple[int, int, int, int]:
    """Sort key, ascending — lowest is best.

    1. Verified at all. A candidate the loop never got as far as verifying either
       failed to execute or ran out of budget first; either way there is no
       evidence about it, and evidence is the whole point of showing it.
    2. Fewest failing deterministic checks. These are the objective ones.
    3. Critic severity. Among candidates the deterministic checks agree on, this
       is the only remaining signal about how wrong it is.
    4. Latest revision. Deliberately the tiebreak rather than critic confidence:
       every candidate here *failed*, so high confidence means "surely broken"
       and low means "possibly broken" — an ordering that would reward vagueness.
       The last revision is the one the repair loop had the most feedback for.
    """
    if verification is None:
        return (1, 0, _UNKNOWN_SEVERITY, -candidate.revision)
    failures = sum(check.get("result") != "pass" for check in verification.deterministic_checks)
    critic = verification.critic if isinstance(verification.critic, dict) else {}
    severity = _SEVERITY_RANK.get(str(critic.get("severity")), _UNKNOWN_SEVERITY)
    return (0, failures, severity, -candidate.revision)


def choose_best_effort(
    candidates: list[CandidateRevision],
    verifications: dict[UUID, VerificationEvidence | None],
) -> BestEffort | None:
    """The closest thing to a working answer this run produced, or None if it
    never produced a candidate at all (e.g. the budget died during planning)."""
    if not candidates:
        return None
    best = min(candidates, key=lambda item: _rank(item, verifications.get(item.candidate_id)))
    return BestEffort(
        candidate=best,
        verification=verifications.get(best.candidate_id),
        candidates_considered=len(candidates),
    )

"""Fail unless every role the active provider profile can call has a key.

Run before a workflow that spends provider tokens, so a missing repository
secret is one clear error at the top instead of a skipped test, a green tick, or
a failure several minutes into a live run at whichever stage happens to need the
key that is absent.

The required set is derived from the role→model→endpoint chain
(`missing_provider_keys`), not hand-listed — three hand-listed copies had already
drifted from the models table in both directions.
"""

from __future__ import annotations

import sys

from majorana_llm import missing_provider_keys, resolve_provider, roles_for_profile


def main() -> int:
    provider = resolve_provider()
    missing = sorted(missing_provider_keys())
    if missing:
        print(
            f"::error::provider profile {provider!r} is incomplete. "
            f"Unset on this repository: {', '.join(missing)}"
        )
        return 1
    print(f"provider profile {provider!r}: every role has a key ({len(roles_for_profile())} roles)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

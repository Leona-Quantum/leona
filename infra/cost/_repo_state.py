"""Print an Artifact Registry repository's size and cleanup policies.

Called by 10-artifact-cleanup.sh. It is a file rather than a `python3 -c`
because the line needs both shell quoting and an f-string's quotes, and one of
them always wins.
"""

import json
import sys

with open(sys.argv[1]) as fh:
    d = json.load(fh)
gb = int(d.get("sizeBytes", 0)) / 1e9
pol = ", ".join(d.get("cleanupPolicies", {})) or "none"
print(f"   {gb:.1f} GB   policies: {pol}   dryRun={d.get('cleanupPolicyDryRun')}")

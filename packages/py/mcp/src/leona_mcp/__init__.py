"""An MCP server over the Quantum Atlas and, with a token, Leona Quantum's runs.

Three tools (`search_methods`, `get_method`, `list_problem_areas`) read one anonymous
API endpoint and need no account. Four more (`run_verified`, `get_run`,
`list_my_runs`, `estimate_resources`; proposal 7 Phase C, ai-ops 349/362) act as the
holder of a personal access token in `LEONA_API_TOKEN` — never as an argument, never
logged. See README.md for how to connect a client and mint a token.
"""

__version__ = "0.2.0"

"""Small, pure helpers shared across the study group's labs and challenges.

Nothing in this package imports Qiskit. Every function takes plain Python
data (a `counts` dict, an `int`, a `float`) and returns plain Python data, so
you can unit test it in milliseconds and reuse it from any week's notebook.
"""

from shared.results import probabilities, top_outcomes, within_band

__all__ = ["probabilities", "top_outcomes", "within_band"]

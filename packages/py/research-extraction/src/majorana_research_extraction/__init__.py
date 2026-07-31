"""Bounded source extraction that never imports or executes target code."""

from .python_ast import (
    EXTRACTOR_VERSION,
    PythonExtractionIssue,
    PythonExtractionLimits,
    PythonExtractionResult,
    PythonFact,
    PythonFactKind,
    SourceSpan,
    extract_python_source,
)

__all__ = [
    "EXTRACTOR_VERSION",
    "PythonExtractionIssue",
    "PythonExtractionLimits",
    "PythonExtractionResult",
    "PythonFact",
    "PythonFactKind",
    "SourceSpan",
    "extract_python_source",
]

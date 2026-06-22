"""Render layer of the Pedagogy Engine.

Renderers turn a surface-agnostic ``PromptPlan`` into something a specific
surface consumes. S1 ships one renderer (``assignment_prompt``) emitting a
system-prompt string for the voice and text tutors. The pluggable renderer
registry (coach track / session.update) is S3, not S1.

This is the only engine layer permitted to know surface/model quirks — and it
still emits a plain string, never an API payload.
"""

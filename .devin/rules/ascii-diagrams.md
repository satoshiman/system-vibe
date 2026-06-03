---
trigger: always_on
---

# ASCII Diagram Rules

When generating documentation diagrams:

- Use Unicode box-drawing characters only:
  ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ │ ─

- Always place diagrams inside fenced code blocks.

- Treat diagrams as fixed-width monospace text.

- All vertical borders must align in the same column.

- All horizontal borders must have matching lengths.

- Arrows and connectors must align exactly to the target box.

- Before returning a diagram:
  1. Verify left/right borders align.
  2. Verify top/bottom borders match.
  3. Verify box widths are consistent.
  4. Verify arrows connect correctly.
  5. Regenerate the diagram if alignment is broken.

- ASCII diagrams are code artifacts, not prose.
  Validate alignment character-by-character before returning.

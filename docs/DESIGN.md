# Quorum design system

The interface is meant to read like a well-set board pack: warm paper, dark ink, one metallic
accent, and a strict editorial hierarchy. Nothing decorative competes with the argument.

## Palette

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `paper` | `#FAF7F1` | `#0F1216` | Page ground |
| `surface` | `#FFFDF8` | `#15181D` | Panels, cards |
| `surface-raised` | `#FFFFFF` | `#1B1F25` | Inputs, popovers |
| `ink` | `#151A21` | `#E9E5DB` | Primary text |
| `ink-soft` | `#3C434D` | `#C9C4B8` | Body text in prose |
| `muted-ink` | `#5A6068` | `#9C978C` | Secondary text |
| `faint-ink` | `#777C82` | `#7A756B` | Metadata, timestamps |
| `line` | `#E6E0D6` | `#22262C` | Hairline rules |
| `line-strong` | `#C9C1B4` | `#3A3F46` | Input borders, separators |
| `bronze` | `#A2773E` | `#C9A86A` | The single accent: action, focus, mark |
| `emerald` | `#2E6350` | `#7FBBA3` | Agreement / positive |
| `oxblood` | `#82424A` | `#D0848C` | Dissent / destructive |

Rules:

- Bronze is **scarce**. One primary action per view, plus the mark and focus states.
- Stance colours are semantic only: never use them as decoration.
- Dark mode is a real palette, not an inversion: bronze brightens, ink warm-greys, lines stay
  low-contrast so the text carries the hierarchy.

## Type

- Display: **Instrument Serif** — headlines, the Chair's brief, the decision question, memos.
  It is the product's speaking voice. Only one weight, never bolded.
- Interface: **Inter** — labels, controls, metadata. 12–14px is the working range; landing body
  copy sits at 14–15px.
- Data: **JetBrains Mono** for model slugs, ids, versions, and keyboard hints.
- Numbers that can be compared (money, confidence, counts) get `font-variant-numeric: tabular-nums`.

Scale (interface): 10px eyebrow (uppercase, 0.14–0.16em tracking) · 12px metadata · 13px control ·
14px body · 17–21px lead · 28–48px display. Avoid 11px body copy; it is for labels only.

## Layout

- Landing: 1180px max, 20–32px gutter, sections separated by hairline bands, one dark band
  (the record) for contrast.
- App: 272px sessions rail · flexible transcript capped at 780px · 340px decision record.
  The record collapses below 1280px; the sessions rail becomes a drawer below 1024px.
- Density is generous: 24–32px vertical rhythm in prose, 12–16px inside controls.

## Motion

- 150–240ms, `cubic-bezier(0.22, 1, 0.36, 1)`, opacity + 8–10px translate only.
- Streaming cursor blinks at 1.1s steps; skeleton lines pulse at 2s.
- Respect `prefers-reduced-motion` globally (already enforced in `index.css`).

## Components

- `Btn` variants: `primary` (ink), `bronze` (the one action), `outline`, `ghost`, `quiet`, `danger`.
- Inputs: 1px `line-strong`, 8px radius, bronze focus ring at 15% opacity.
- Chips: 11px, hairline border, semantic wash background.
- Cards: hairline border + `shadow-quiet` only when elevation communicates state (modals,
  popovers, the hero preview). Never stack a border and a heavy shadow.

## Voice

- Speaking to the operator: **Chair**. The AI participants: **directors**, not "experts" or
  "personas". A session is a **board session**; its output is a **decision memo**.
- Sentences are declarative and short. No exclamation marks, no "supercharge", no emoji in UI copy.
- Honesty is part of the design: advice is not fact, charts need real numbers, billing failures say
  so plainly.

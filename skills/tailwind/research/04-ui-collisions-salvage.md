> **Provenance:** **live** for KEEP/DROP of C1–C8. C7’s specificity write-up is **WRONG and superseded** — [06-state-specificity-compile.md](06-state-specificity-compile.md) compiled it: stock ties at (0,2,0) and the active state wins on emission order (no bug); shadcn’s `:where()` wrapper is what demotes it. Do not cite C7 from here.
>
> The `ui-collisions` skill this file salvaged from was **deleted on 2026-08-20** as unverified; its log is archived outside this repo.

# Task 4 — UI-collisions salvage

Judged against **this** skill’s scope: Tailwind v4 syntax, shadcn **semantic-token house style**, cleanup pass. Sidebar-08 / Base-UI / inset-layout wiring belongs in `ui-collisions`, not here.

Prior challenged where the CSS claim was wrong or the lesson is design-only.

---

## Would change the skill (KEEP)

### C5 — KEEP → `tailwind/SKILL.md` (colour ladder) and `tailwind/references/cleanup.md` (token drift)

This is token-contract work, not sidebar trivia. Agents recolour `--sidebar-primary` (or `--primary`) because the name sounds like “active brand,” while the component actually paints with `--sidebar-accent` / `bg-sidebar-accent`. That is the same failure mode as recolouring `--background` when the surface is `--card`.

**Add (SKILL.md, under “Reach for a semantic token”):**

Map the token the **class list actually consumes** before changing `:root` / `.dark`. Read `bg-*` / `text-*` / `border-*` on the variant, not the token’s English name. `--sidebar-primary` is not “the active item” unless the markup uses `bg-sidebar-primary`.

**Add (cleanup.md, Token drift):**

Flag a token edit that does not match the utilities on the target (`--sidebar-primary` vs `bg-sidebar-accent`). Don’t retarget tokens by name.

### C4 — KEEP → `tailwind/SKILL.md` (colour ladder, “No brand ramp”) and `cleanup.md`

In scope: `--primary` is a **role**, and `Badge variant="default"` is `bg-primary`. Changing the brand fill ripples. Passive chips should not share the solid intent fill.

**Add (SKILL.md):**

A token is a role, not a one-off paint. Changing `--primary` restyles every `bg-primary` (default Button **and** default Badge). Passive chips/counts: `bg-secondary` / `bg-muted` or `bg-primary/10 text-primary`, not a second solid brand fill.

**Add (cleanup.md, Token drift):**

If a rebrand made every default Badge as loud as the primary button, candidate: default badges → `secondary` / muted / `bg-primary/10`, keep solid `--primary` for intent.

### C7 — KEEP, claim is correct enough → `cleanup.md` (never auto-swap states) + one line in SKILL.md canonical section

**Specificity check:** Tailwind `hover:bg-X` compiles to a **class + `:hover`** (plus `@media (hover: hover)`). `data-active:bg-X` compiles to a **class + `[data-active]`** (or equivalent). Those are the same specificity band `(0, 2, 0)`. Source order then decides; hover often wins on the active node. `data-active:hover:bg-X` is **class + attribute + `:hover`** → `(0, 3, 0)` and wins. The log’s “plain `:hover` vs `[data-active]`” is a slight simplification of Tailwind’s extra class, but the **ranking and the compound-variant fix are right**.

Do **not** put this in a sidebar-only file. Variant stacking vs hover is a cleanup landmine (`Never touch` already says don’t shuffle state variants; this explains *why* an active item can lose).

**Add (cleanup.md, after “two classes setting the same property”):**

`hover:` and `data-active:` (same property) are equal specificity; emission order decides, and hover can demote the active styles. If active must hold on hover, the candidate is a compound `data-active:hover:` utility — do not auto-apply.

**Add (SKILL.md, do-not-over-correct / states):**

Stacked `data-active:hover:` is how you keep the selected style on hover; do not “simplify” it to `hover:` + `data-active:` as two separate colours of the same property.

---

## DROP (do not add to this skill)

| ID | Verdict | Why |
| --- | --- | --- |
| C1 | DROP | Framework-fit: Radix block vs Base UI `render=`. Not Tailwind syntax or the token scaffold. |
| C2 | DROP | sidebar-08 wiring (`variant="inset"`, trigger placement, header seam). Reference fidelity, not class/token rules. |
| C3 | DROP | Unrequested `SidebarRail`. Product/affordance, not v4 house style. |
| C6 | DROP | “Hover must read lighter than active” is **visual ranking**, not a Tailwind or token-contract rule. C7 already covers the selector failure; C6’s 50% tint is a design choice that will be wrong on some palettes. Keep it in `ui-collisions`. |
| C8 | DROP | `SidebarInset` `peer-data-[state=collapsed]:ml-2` vs icon collapse. Component-specific spacing. |

C6 was listed as “borderline KEEP.” **Drop it here.** This skill should not encode a hover-opacity recipe. C4/C5/C7 already capture the transferable token + specificity lessons without the sidebar paint.

---

## Sources (C7)

- https://tailwindcss.com/docs/hover-focus-and-other-states (hover → `@media (hover: hover) { &:hover }`; `data-[…]` → `&[data-…]`)
- CSS specificity: one class + one pseudo-class equals one class + one attribute selector; adding both on one utility raises the class/attr/pseudo count.

# Design System: The Analytical Architect

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Cartographer"**
This design system moves beyond the standard "dashboard" aesthetic to embrace the precision of high-end technical cartography. We are not just displaying data; we are mapping institutional intelligence. The visual language is defined by **Structured Ethereality**—a combination of rigid, mathematical spacing and soft, layered depth. 

We break the "template" look through:
*   **Intentional Asymmetry:** Information-heavy sidebars balanced against expansive, breathable graph canvases.
*   **Tonal Depth:** Replacing harsh lines with sophisticated shifts in surface luminance.
*   **Editorial Typography:** Pairing the utilitarian precision of *Inter* with the architectural character of *Space Grotesk* to signal both technical authority and premium quality.

---

## 2. Colors & Surface Logic
The palette is rooted in deep, intellectual tones (Deep Blue, Dark Teal, Rich Purple) set against a clinical, high-contrast light grey environment.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning. Boundaries must be defined solely through background color shifts. For example, a `surface-container-low` sidebar sitting on a `surface` background provides all the separation required. 

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of fine architectural vellum.
*   **Base:** `surface` (#f9f9f9) - The primary canvas.
*   **Mid-Level:** `surface-container-low` (#f3f3f3) - For secondary navigation or utility panels.
*   **High-Level:** `surface-container-lowest` (#ffffff) - Reserved for active data cards and focused content to create a natural "pop" against the grey background.

### The "Glass & Gradient" Rule
To avoid a flat, "SaaS-standard" feel, use **Glassmorphism** for floating graph overlays and inspectors. Use `surface-container-lowest` at 80% opacity with a `20px` backdrop blur. 
*   **Signature Gradients:** For primary CTAs or Knowledge Graph "Hero Nodes," use a subtle linear gradient: `primary` (#000666) to `primary-container` (#1a237e). This adds "soul" and dimension to technical elements.

---

## 3. Typography: The Intellectual Hierarchy
We utilize a dual-font strategy to balance readability with high-end editorial flair.

*   **Display & Headlines (`Space Grotesk`):** Used for data summaries and page titles. The geometric nature of Space Grotesk mirrors the nodes and links of a knowledge graph.
    *   *Headline-LG:* 2rem — For primary entity names.
*   **Titles & Body (`Inter`):** Used for all functional data, labels, and technical descriptions. Inter’s high x-height ensures legibility in dense data environments.
    *   *Body-MD:* 0.875rem — The workhorse for metadata and property values.
    *   *Label-SM:* 0.6875rem — Used for "Layer Badges" and micro-annotations.

---

## 4. Elevation & Depth
In this design system, elevation is conveyed through **Tonal Layering** rather than traditional structural lines.

*   **The Layering Principle:** Stack `surface-container` tiers to create hierarchy. A `surface-container-highest` element should only exist inside a `surface-container-low` parent, creating a logical "step up" in the user's focus.
*   **Ambient Shadows:** When an element must float (e.g., a node inspector), use a shadow with a `24px` blur and `4%` opacity, using the `on-surface` color (#1a1c1c). It should look like a soft atmospheric glow, not a drop shadow.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility (e.g., in a high-density table), use `outline-variant` (#c6c5d4) at **15% opacity**. High-contrast, 100% opaque borders are strictly forbidden.

---

## 5. Components

### Knowledge Graph Nodes
*   **Visuals:** Circles or rounded-hexagons using the `xl` (0.75rem) roundedness scale. 
*   **Logic:** Use `primary` for Dalai Layer, `secondary` for Private Layer, and `tertiary` for DLS Layer. 
*   **Interactive State:** On hover, apply a `primary-fixed` glow using a 10% opacity spread.

### Relationship Links (Edges)
*   **Visuals:** 1.5px paths using `outline-variant`. 
*   **Logic:** Directional arrows should be subtle, integrated into the stroke. Use "Ghost Border" logic for non-active links; brighten to `primary` on selection.

### Layer Badges
*   **Visuals:** Pill-shaped (`full` roundedness) with a low-saturation background and high-saturation text.
*   **Formula:** `primary-fixed` background with `on-primary-fixed` text. This ensures the technical "tag" feels integrated, not distracting.

### Data Cards
*   **Rule:** **No Divider Lines.** Separate header from body using a `12` (2.75rem) spacing unit or a subtle shift from `surface-container-lowest` to `surface-container-low`.
*   **Interaction:** On hover, transition the background slightly to `surface-bright`.

### Input Fields & Search
*   **Visuals:** Use `surface-container-high` as the fill. No bottom border. Focus state is indicated by a 2px `primary` "Ghost Border" (20% opacity).

---

## 6. Do's and Don'ts

### Do
*   **Do** use expansive white space (Scale `16` or `20`) to separate major functional areas.
*   **Do** use subtle background transitions to guide the eye through the data hierarchy.
*   **Do** lean into the "Architectural" feel—align elements to a strict 4px baseline but allow the overall layout to feel asymmetrical and custom.

### Don't
*   **Don't** use 1px solid black or dark grey borders for any reason.
*   **Don't** use standard "Material Design" shadows. Keep elevations soft, wide, and low-opacity.
*   **Don't** use pure black (#000000) for text. Use `on-surface` (#1a1c1c) to maintain a premium, softer contrast.
*   **Don't** crowd the Knowledge Graph. Use the spacing scale to ensure "Breathing Room" around nodes.
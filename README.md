# AEM to CMS Migration POC v2

An AI-powered pipeline that transforms AEM page exports (JCR format) into a normalized CMS schema and generates fully-rendered HTML pages. **Version 2 introduces a Component Template Registry** — AI templates are generated once and reused across unlimited pages, eliminating redundant LLM calls.

## The Problem Solved

**v1 Architecture (Inefficient):**
```
30,000 pages × 5 component types = 150,000 LLM calls ❌
```

**v2 Architecture (Efficient):**
```
5 unique component types = 5 LLM calls (ever)  ✅
30,000 pages = pure Handlebars binding         ✅
```

## Overview

The three-step pipeline:

1. **Importer**: Parses AEM JCR JSON and normalizes to CMS schema (input-agnostic)
2. **AI Generator**: Checks the **Component Template Registry** for each component type:
   - **Registry HIT**: Load cached template from disk (instant, zero LLM cost)
   - **Registry MISS**: Call Ollama once, save to registry forever
3. **Renderer**: Hydrates registry templates with page data → final HTML

## Key Architectural Features

- **Persistent Registry** (`component-registry/`) stores all AI-generated templates
- **Single Command Handles Multiple Pages** — same pipeline processes any input
- **Clear Console Feedback** — see `[REGISTRY HIT]` vs `[AI GENERATING]` in real-time
- **Demo-Ready** — process two pages to show caching in action

## Prerequisites

### 1. Install Ollama
- **macOS**: `brew install ollama`
- **Linux**: `curl -fsSL https://ollama.com/install.sh | sh`
- **Windows**: Download from https://ollama.ai/download

### 2. Pull the Model
```bash
ollama pull qwen2.5-coder:7b
```

### 3. Start Ollama Server
```bash
ollama serve
```
The server runs on `http://localhost:11434`

### 4. Install Node Dependencies
```bash
npm install
```

## Project Structure

```
aem-cms-poc/
├── input.json                        # AEM JCR page export - Page 1
├── input2.json                       # AEM JCR page export - Page 2 (demo)
├── output.json                       # Reference CMS schema format
├── src/
│   ├── importer.js                   # Parse AEM → CMS schema
│   ├── ai-generator.js               # Registry-aware AI template generator
│   ├── renderer.js                   # Render page HTML
│   └── pipeline.js                   # Orchestrator (accepts CLI args)
├── component-registry/               # ⭐ Persistent template cache
│   ├── hero-banner.html              # Auto-generated, reused
│   ├── richtext.html
│   ├── card-list.html
│   ├── promo.html
│   └── teaser.html
├── design-tokens.css                 # Design system CSS variables
├── generated/
│   ├── output.json                   # Normalized schema - Page 1
│   ├── output2.json                  # Normalized schema - Page 2
│   ├── page1.html                    # Rendered page - Page 1
│   └── page2.html                    # Rendered page - Page 2
├── package.json
└── README.md
```

## Usage

### Option 1: Process a Single Page (Default)
```bash
npm start
```
Processes `input.json` → `generated/output.json` and `generated/page1.html`

### Option 2: Process Multiple Pages with Registry Demo

#### Step 1 — Process Page 1 (generates templates)
```bash
npm run page1
```

Expected output shows `[AI GENERATING]` and `[REGISTRY SAVE]`:
```
STEP 2 — Resolving component templates...
  ⚡ [AI GENERATING] hero-banner — calling Qwen2.5-Coder...
  💾 [REGISTRY SAVE] hero-banner — saved to component-registry/
  ⚡ [AI GENERATING] richtext — calling Qwen2.5-Coder...
  💾 [REGISTRY SAVE] richtext — saved to component-registry/
  ...
```

Open `generated/page1.html` in a browser to see the rendered page.

#### Step 2 — Process Page 2 (zero AI calls)
```bash
npm run page2
```

Expected output shows `[REGISTRY HIT]` (instant, no LLM):
```
STEP 2 — Resolving component templates...
  ✓ [REGISTRY HIT]  hero-banner — loaded from disk
  ✓ [REGISTRY HIT]  richtext — loaded from disk
  ✓ [REGISTRY HIT]  card-list — loaded from disk
  ...
```

Open `generated/page2.html` in a browser. **Visually consistent with page1, but rendered instantly with different content.**

### Custom Pipeline
Process any AEM export with custom output paths:
```bash
node src/pipeline.js <inputFile> <outputJson> <outputHtml>
```

Example:
```bash
node src/pipeline.js my-page.json generated/my-schema.json generated/my-page.html
```

## How It Works

### Step 1: AEM Importer

Parses raw AEM JCR JSON and normalizes to CMS schema:
- Extracts page metadata (title, template, tags)
- Recursively walks component tree
- Converts `itemN` node patterns → arrays
- Remaps AEM paths → CMS paths
- Strips internal JCR/Sling/CQ metadata
- Assigns order by traversal sequence

Output: Structured CMS schema with all components normalized.

### Step 2: Registry-Aware AI Generator ⭐

For each unique component type needed by a page:

1. **Check Registry** (`component-registry/`):
   - If template exists → load from disk (instant)
   - If missing → call Ollama

2. **Generate Template** (on registry miss):
   - Send prompt to Qwen2.5-Coder with component type, sample data, design tokens
   - Receive Handlebars-bound HTML template
   - Save to `component-registry/{type}.html` immediately

3. **Return Template** for rendering

The registry is persistent across runs — **only new component types trigger AI calls**.

### Step 3: Renderer

Hydrates all templates with actual page data:
- Sort components by order
- For each component: `Handlebars.compile(template)(data)`
- Wrap in full HTML page shell
- Write to output path

Fallback: If a component type has no template, render a basic div with all fields listed.

## Component Type Mapping

| AEM `sling:resourceType` | CMS `type` | Registry File |
|---|---|---|
| `mysite/components/content/hero-banner` | `hero-banner` | `component-registry/hero-banner.html` |
| `mysite/components/content/richtext` | `richtext` | `component-registry/richtext.html` |
| `mysite/components/content/card-list` | `card-list` | `component-registry/card-list.html` |
| `mysite/components/content/promo` | `promo` | `component-registry/promo.html` |
| `mysite/components/content/teaser` | `teaser` | `component-registry/teaser.html` |
| `wcm/foundation/components/responsivegrid` | *(skipped)* | — |

## Path Remapping

AEM paths are automatically converted:

| AEM Path | CMS Path |
|---|---|
| `/content/dam/mysite/images/` | `/assets/images/` |
| `/content/dam/mysite/icons/` | `/assets/icons/` |
| `/content/dam/mysite/` | `/assets/` |
| `/content/mysite/en/` | `/` |

## Design System

All templates use CSS variables from `design-tokens.css`:
- **Colors**: Primary, secondary, accent, text, backgrounds
- **Typography**: Font families, sizes, weights
- **Spacing**: Responsive scale (sm, md, lg, xl, 2xl, 3xl)
- **Utilities**: Max-width, border-radius, shadows

No hardcoded colors or spacing in templates — all configurable via design tokens.

## Demo Workflow

Perfect for showcasing the registry efficiency:

1. **Run `npm run page1`**
   - Watch AI generate 5 templates
   - See them saved to `component-registry/`
   - Browse rendered `page1.html`

2. **Run `npm run page2`**
   - See all 5 components load from registry (instant)
   - Zero AI calls
   - Browse rendered `page2.html` (same visual style, different content)

3. **Talk through it:**
   > "Page 1 generates the templates through AI — that's a one-time cost. Page 2 reuses them instantly. Now imagine 30,000 pages. Same 5 templates, zero additional AI calls. The registry is owned by the dev team and can be edited like any HTML file."

## Troubleshooting

### Ollama Connection Failed
- Ensure Ollama server is running: `ollama serve`
- Check connectivity: `curl http://localhost:11434/api/tags`

### Model Not Found
- Pull the model: `ollama pull qwen2.5-coder:7b`

### Template Generation Slow
- First template per type takes 30–60 seconds (normal for Ollama on first run)
- Subsequent pages load templates instantly from registry

### Registry Not Being Used
- Verify `component-registry/` directory exists and has `.html` files
- Delete `component-registry/` to force regeneration and see `[AI GENERATING]` again

## Success Criteria

✅ `npm run page1` generates 5 templates in `component-registry/` and renders `page1.html`
✅ `npm run page2` shows `[REGISTRY HIT]` for all components (zero LLM calls)
✅ `component-registry/*.html` files use Handlebars syntax, not hardcoded data
✅ Both pages open and render with design tokens applied
✅ Page 1 and Page 2 are visually consistent but have different content
✅ No AEM `/content/` paths remain in output files
✅ Deleting registry and rerunning triggers AI generation again

## Technologies Used

- **Node.js** — Runtime
- **Handlebars** — Template engine for reusable components
- **Ollama** — Local LLM inference
- **Qwen2.5-Coder** — AI model for HTML generation
- **CSS Custom Properties** — Design system tokens

## License

POC for demonstration purposes.

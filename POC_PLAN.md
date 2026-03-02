# AEM to CMS Migration POC — Implementation Plan v2
## Component Template Registry + Efficient Rendering

## What Changed from v1

The core architectural shift in v2 is a **Component Template Registry**. Instead of calling the LLM per page, AI is called **once per unique component type** and the generated template is saved to disk. All subsequent page renders use the registry directly — zero LLM calls.

```
v1: 30,000 pages × 5 components = 150,000 LLM calls  ❌
v2: 5 unique component types = 5 LLM calls (ever)     ✅
    30,000 pages = pure Handlebars binding             ✅
```

---

## Project Structure

```
aem-cms-poc/
├── input.json                        # AEM JCR page export - Page 1
├── input2.json                       # AEM JCR page export - Page 2 (for demo)
├── output.json                       # Target CMS schema reference format
├── src/
│   ├── importer.js                   # Step 1: Parse + normalize AEM JSON → CMS schema
│   ├── ai-generator.js               # Step 2: Registry-aware AI template generator
│   ├── renderer.js                   # Step 3: Bind CMS schema data into HTML
│   └── pipeline.js                   # Orchestrator: runs all steps in sequence
├── component-registry/               # ⭐ NEW: Persistent template store
│   ├── hero-banner.html              # AI-generated Handlebars template (generated once)
│   ├── card-list.html
│   ├── richtext.html
│   ├── promo.html
│   └── teaser.html
├── design-tokens.css                 # Design system CSS variables
├── generated/
│   ├── output.json                   # Generated CMS schema - Page 1
│   ├── output2.json                  # Generated CMS schema - Page 2
│   ├── page1.html                    # Rendered Page 1
│   └── page2.html                    # Rendered Page 2 (instant, no LLM)
├── package.json
└── README.md
```

---

## Prerequisites

### 1. Install Ollama
```bash
# macOS
brew install ollama
# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull the Model
```bash
ollama pull qwen2.5-coder:7b
```

### 3. Start Ollama Server
```bash
ollama serve   # Runs on http://localhost:11434
```

### 4. Install Node Dependencies
```bash
npm install
```

**package.json:**
```json
{
  "name": "aem-cms-poc",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/pipeline.js",
    "page1": "node src/pipeline.js input.json generated/output.json generated/page1.html",
    "page2": "node src/pipeline.js input2.json generated/output2.json generated/page2.html"
  },
  "dependencies": {
    "handlebars": "^4.7.8",
    "node-fetch": "^3.3.2",
    "fs-extra": "^11.2.0"
  }
}
```

---

## Step 1: AEM Importer (`src/importer.js`)

**No changes from v1.** Same logic — parse AEM JCR JSON and normalize to CMS schema.

**Logic recap:**
1. Read input AEM JSON file (path passed as argument)
2. Extract page metadata from `jcr:content` (title, pageTitle, navTitle, template, tags)
3. Walk `jcr:content.root` recursively
4. Skip nodes where `sling:resourceType` contains `responsivegrid`
5. For each content node:
   - Strip `mysite/components/content/` prefix from `sling:resourceType` → `type`
   - Strip all keys starting with `jcr:`, `sling:`, `cq:`
   - Convert `item0/item1/item2` patterns → proper arrays
   - Remap asset paths: `/content/dam/mysite/` → `/assets/`, `/content/mysite/en/` → `/`
   - Assign `order` by traversal sequence
6. Write normalized JSON to output path passed as argument

**Output schema (unchanged):**
```json
{
  "Id": "home",
  "key": "Home",
  "DynamicProperties": {
    "title": "...",
    "pageTitle": "...",
    "navTitle": "...",
    "template": "...",
    "tags": [],
    "Webparts": [
      { "type": "hero-banner", "order": 1, "data": { } }
    ]
  }
}
```

---

## Step 2: Registry-Aware AI Generator (`src/ai-generator.js`) ⭐ UPDATED

**Purpose:** For each component type needed by a page, check the registry first. Only call Ollama if the template does not exist yet. Save new templates to the registry immediately after generation.

**Registry directory:** `component-registry/` at project root. Create it if it does not exist.

**Core logic — `getTemplate(componentType, sampleData, designTokens)`:**

```javascript
import fs from 'fs-extra';
import path from 'path';
import fetch from 'node-fetch';

const REGISTRY_DIR = 'component-registry';

export async function getTemplate(componentType, sampleData, designTokens) {
  const registryPath = path.join(REGISTRY_DIR, `${componentType}.html`);

  // ⭐ Registry hit — load from disk, no LLM call
  if (await fs.pathExists(registryPath)) {
    console.log(`  ✓ [REGISTRY HIT]  ${componentType} — loaded from disk`);
    return fs.readFile(registryPath, 'utf8');
  }

  // ⭐ Registry miss — call Ollama and save result
  console.log(`  ⚡ [AI GENERATING] ${componentType} — calling Qwen2.5-Coder...`);
  const template = await callOllama(componentType, sampleData, designTokens);
  
  await fs.ensureDir(REGISTRY_DIR);
  await fs.writeFile(registryPath, template, 'utf8');
  console.log(`  💾 [REGISTRY SAVE] ${componentType} — saved to component-registry/`);
  
  return template;
}
```

**`callOllama(componentType, sampleData, designTokens)` function:**

```javascript
async function callOllama(componentType, sampleData, designTokens) {
  const prompt = buildPrompt(componentType, sampleData, designTokens);

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen2.5-coder:7b',
      stream: false,
      prompt
    })
  });

  const result = await response.json();
  
  // Strip markdown fences if model wraps output in ```html ... ```
  return result.response
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}
```

**`buildPrompt(componentType, sampleData, designTokens)` function:**

```
You are an expert frontend developer. Generate a reusable semantic HTML template for a CMS component.

COMPONENT TYPE: {componentType}

SCHEMA FIELDS (with sample data to understand field types and structure):
{JSON.stringify(sampleData, null, 2)}

DESIGN TOKENS (CSS variables you must use — do not hardcode colors, spacing, or fonts):
{designTokens}

RULES:
- Use Handlebars syntax for all data bindings
- Plain text fields: {{fieldName}}
- Raw HTML fields (e.g. richtext): {{{fieldName}}}
- Arrays: {{#each items}}<element>{{this.title}}</element>{{/each}}
- Conditionals: {{#if fieldName}}<element>...</element>{{/if}}
- Use BEM CSS class naming: .component-type__element--modifier
- All colors, spacing, font sizes must use CSS variables from the design tokens
- Include a <style> block with scoped BEM classes at the top of the output
- Make the component responsive using CSS Grid or Flexbox
- This template will be reused across many pages — make it generic, not hardcoded

OUTPUT: Return ONLY the HTML block for this one component. No page shell. No explanation. No markdown fences.
```

**`generateTemplates(cmsSchema)` exported function:**

```javascript
export async function generateTemplates(cmsSchema) {
  const designTokens = await fs.readFile('design-tokens.css', 'utf8');
  const webparts = cmsSchema.DynamicProperties.Webparts;

  // Get unique component types only
  const uniqueTypes = [...new Map(
    webparts.map(wp => [wp.type, wp])
  ).values()];

  console.log(`\nComponent types needed: ${uniqueTypes.map(w => w.type).join(', ')}`);

  const templateMap = {};
  for (const webpart of uniqueTypes) {
    templateMap[webpart.type] = await getTemplate(
      webpart.type,
      webpart.data,
      designTokens
    );
  }
  return templateMap;
}
```

---

## Step 3: Renderer (`src/renderer.js`)

**No changes from v1.** Accepts CMS schema + template map, hydrates with Handlebars, writes final HTML page.

**Logic recap:**
1. Sort Webparts by `order`
2. For each Webpart: `Handlebars.compile(templateMap[webpart.type])(webpart.data)`
3. Wrap rendered components in full page shell with design-tokens.css linked
4. Write to output HTML path passed as argument

**Fallback:** If a component type has no template, render a plain `<div class="{type}-fallback">` with all data fields as `<p>` tags.

---

## Step 4: Pipeline Orchestrator (`src/pipeline.js`) ⭐ UPDATED

Accept CLI arguments so the same pipeline can process multiple pages.

```javascript
// src/pipeline.js
import { runImporter } from './importer.js';
import { generateTemplates } from './ai-generator.js';
import { renderPage } from './renderer.js';
import fetch from 'node-fetch';

// CLI args: node src/pipeline.js <inputJson> <outputJson> <outputHtml>
const [,, 
  inputPath  = 'input.json',
  outputJson = 'generated/output.json',
  outputHtml = 'generated/page1.html'
] = process.argv;

async function runPipeline() {
  // 0. Check Ollama is reachable
  try {
    await fetch('http://localhost:11434/api/tags');
  } catch {
    console.error('\n❌ ERROR: Ollama not running. Start it with: ollama serve\n');
    process.exit(1);
  }

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  AEM → CMS Migration Pipeline v2`);
  console.log(`  Input:  ${inputPath}`);
  console.log(`  Schema: ${outputJson}`);
  console.log(`  Page:   ${outputHtml}`);
  console.log(`═══════════════════════════════════════════\n`);

  console.log('STEP 1 — Importing AEM JSON → CMS Schema...');
  const cmsSchema = await runImporter(inputPath, outputJson);
  console.log(`  ✓ Found ${cmsSchema.DynamicProperties.Webparts.length} components\n`);

  console.log('STEP 2 — Resolving component templates...');
  const templateMap = await generateTemplates(cmsSchema);
  console.log();

  console.log('STEP 3 — Rendering page HTML...');
  await renderPage(cmsSchema, templateMap, outputHtml);
  console.log(`  ✓ Page rendered\n`);

  console.log('═══════════════════════════════════════════');
  console.log('  ✅ Done!');
  console.log(`  CMS Schema  → ${outputJson}`);
  console.log(`  Rendered    → ${outputHtml}`);
  console.log(`  Registry    → component-registry/ (${Object.keys(templateMap).length} templates)`);
  console.log('═══════════════════════════════════════════\n');
}

runPipeline().catch(console.error);
```

---

## Step 5: Design Tokens (`design-tokens.css`)

**No changes from v1.**

```css
:root {
  --color-primary: #003366;
  --color-secondary: #0066cc;
  --color-accent: #ff6600;
  --color-text: #1a1a1a;
  --color-text-light: #666666;
  --color-bg: #ffffff;
  --color-bg-alt: #f5f5f5;
  --color-white: #ffffff;

  --font-family-base: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.25rem;
  --font-size-xl: 1.5rem;
  --font-size-2xl: 2rem;
  --font-size-3xl: 3rem;
  --font-weight-normal: 400;
  --font-weight-bold: 700;

  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --space-3xl: 64px;

  --max-width: 1200px;
  --border-radius: 8px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.12);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.1);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font-family-base); color: var(--color-text); }
```

---

## Step 6: Create `input2.json` for Demo

Create a second AEM page JSON that reuses the same component types as `input.json` but with different content. This is critical for the boss demo — it proves the registry works across pages.

Use these same component types: `hero-banner`, `richtext`, `card-list`, `promo`, `teaser`
Use different data values (different headline, different cards, different CTA text etc.)

---

## The Boss Demo Script

Run these three commands in sequence and talk through the console output:

### Run 1 — Process Page 1 (AI generates templates)
```bash
npm run page1
```

**Expected console output:**
```
STEP 2 — Resolving component templates...
  ⚡ [AI GENERATING] hero-banner — calling Qwen2.5-Coder...
  💾 [REGISTRY SAVE] hero-banner — saved to component-registry/
  ⚡ [AI GENERATING] richtext — calling Qwen2.5-Coder...
  💾 [REGISTRY SAVE] richtext — saved to component-registry/
  ⚡ [AI GENERATING] card-list — calling Qwen2.5-Coder...
  💾 [REGISTRY SAVE] card-list — saved to component-registry/
  ⚡ [AI GENERATING] promo — calling Qwen2.5-Coder...
  💾 [REGISTRY SAVE] promo — saved to component-registry/
  ⚡ [AI GENERATING] teaser — calling Qwen2.5-Coder...
  💾 [REGISTRY SAVE] teaser — saved to component-registry/
```

**Show:** Open `component-registry/` folder — 5 reusable `.html` template files.
**Show:** Open `generated/page1.html` in browser.

### Run 2 — Process Page 2 (zero AI calls)
```bash
npm run page2
```

**Expected console output:**
```
STEP 2 — Resolving component templates...
  ✓ [REGISTRY HIT]  hero-banner — loaded from disk
  ✓ [REGISTRY HIT]  richtext — loaded from disk
  ✓ [REGISTRY HIT]  card-list — loaded from disk
  ✓ [REGISTRY HIT]  promo — loaded from disk
  ✓ [REGISTRY HIT]  teaser — loaded from disk
```

**Talk track:** "Page 2 rendered instantly. No AI calls. Same registry templates, different data.
This is how all 30,000 pages would work — AI ran 5 times total, not 30,000 times."

**Show:** Open `generated/page2.html` in browser — visually consistent with page1 but different content.

### Show the Registry Files
Open any file in `component-registry/` — e.g. `card-list.html`:

```html
<style>
  .card-list { ... uses var(--color-primary) ... }
  .card-list__item { ... uses var(--space-lg) ... }
</style>

<section class="card-list">
  <h2 class="card-list__heading">{{heading}}</h2>
  <div class="card-list__grid card-list__grid--{{layout}}">
    {{#each items}}
    <div class="card-list__item">
      <img class="card-list__icon" src="{{icon}}" alt="{{title}}">
      <h3 class="card-list__title">{{title}}</h3>
      <p class="card-list__description">{{description}}</p>
    </div>
    {{/each}}
  </div>
</section>
```

**Talk track:** "This template is owned by the team now. It's a standard HTML file.
Any developer can edit it. Any new page with a card-list uses this automatically."

---

## AEM Component Type Mapping

| AEM `sling:resourceType` | CMS `type` | Registry file |
|---|---|---|
| `mysite/components/content/hero-banner` | `hero-banner` | `component-registry/hero-banner.html` |
| `mysite/components/content/richtext` | `richtext` | `component-registry/richtext.html` |
| `mysite/components/content/card-list` | `card-list` | `component-registry/card-list.html` |
| `mysite/components/content/promo` | `promo` | `component-registry/promo.html` |
| `mysite/components/content/teaser` | `teaser` | `component-registry/teaser.html` |
| `wcm/foundation/components/responsivegrid` | *(skip — layout container)* | — |

## AEM Path Remapping Rules

| AEM Path | CMS Path |
|---|---|
| `/content/dam/mysite/images/` | `/assets/images/` |
| `/content/dam/mysite/icons/` | `/assets/icons/` |
| `/content/mysite/en/` | `/` |
| `/content/dam/mysite/` | `/assets/` |

---

## Success Criteria

- [ ] `npm run page1` generates 5 templates in `component-registry/` via AI and renders `page1.html`
- [ ] `npm run page2` shows all 5 components as `[REGISTRY HIT]` — zero LLM calls — and renders `page2.html`
- [ ] `component-registry/*.html` files use Handlebars `{{field}}` bindings, not hardcoded data
- [ ] Both pages open in browser and render all components visually with design tokens applied
- [ ] `page1.html` and `page2.html` are visually consistent (same templates) but have different content
- [ ] No AEM `/content/` paths remain in any output file
- [ ] Deleting `component-registry/` and rerunning triggers AI generation again (registry is the cache)

---

## Notes for Claude Code

- `component-registry/` is the persistent cache — if this folder exists with templates, Page 2 onwards need zero LLM calls
- The pipeline script accepts CLI arguments for input/output paths so the same code handles any page
- Use `fs-extra`'s `pathExists` (not `fs.existsSync`) for async-safe registry checks
- Generate templates for unique component types only, not per Webpart instance
- The `richtext` component's `text` field contains raw HTML — the template must use `{{{text}}}` triple-stash
- `input2.json` must be created with the same component types as `input.json` but different field values
- Print clear `[REGISTRY HIT]` vs `[AI GENERATING]` labels in console — this is the visual proof for the demo
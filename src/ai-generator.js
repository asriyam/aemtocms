import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = path.join(__dirname, '..', 'component-registry');

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'qwen2.5-coder:7b';

/**
 * Build the prompt for Ollama
 * @param {string} componentType - Component type (e.g., 'hero-banner')
 * @param {Object} sampleData - Sample data for the component
 * @param {string} designTokens - CSS variables string
 * @returns {string} Formatted prompt
 */
function buildPrompt(componentType, sampleData, designTokens) {
  return `You are an expert frontend developer. Generate a reusable semantic HTML template for a CMS component.

COMPONENT TYPE: ${componentType}

SCHEMA FIELDS (with sample data to understand field types and structure):
${JSON.stringify(sampleData, null, 2)}

DESIGN TOKENS (CSS variables you must use — do not hardcode colors, spacing, or fonts):
${designTokens}

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

OUTPUT: Return ONLY the HTML block for this one component. No page shell. No explanation. No markdown fences.`;
}

/**
 * Call Ollama to generate HTML template
 * @param {string} componentType - Component type
 * @param {Object} sampleData - Sample data for component
 * @param {string} designTokens - CSS variables
 * @returns {Promise<string>} Generated HTML template
 */
async function callOllama(componentType, sampleData, designTokens) {
  try {
    const prompt = buildPrompt(componentType, sampleData, designTokens);
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        prompt
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const result = await response.json();
    let html = result.response || '';

    // Strip markdown fences if model wraps output
    html = html
      .replace(/^```html\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return html;
  } catch (error) {
    console.error('ERROR calling Ollama:', error.message);
    throw error;
  }
}

/**
 * Get template for a component type — from registry or via AI generation
 * @param {string} componentType - Component type
 * @param {Object} sampleData - Sample data for the component
 * @param {string} designTokens - CSS variables
 * @returns {Promise<string>} HTML template
 */
async function getTemplate(componentType, sampleData, designTokens) {
  const registryPath = path.join(REGISTRY_DIR, `${componentType}.html`);

  // Check if template exists in registry
  if (await fs.pathExists(registryPath)) {
    console.log(`  ✓ [REGISTRY HIT]  ${componentType} — loaded from disk`);
    return fs.readFile(registryPath, 'utf8');
  }

  // Registry miss — call Ollama and save result
  console.log(`  ⚡ [AI GENERATING] ${componentType} — calling Qwen2.5-Coder...`);
  const template = await callOllama(componentType, sampleData, designTokens);

  // Save to registry
  await fs.ensureDir(REGISTRY_DIR);
  await fs.writeFile(registryPath, template, 'utf8');
  console.log(`  💾 [REGISTRY SAVE] ${componentType} — saved to component-registry/`);

  return template;
}

/**
 * Generate HTML templates for all unique component types in a page
 * @param {Object} cmsSchema - CMS schema from importer
 * @returns {Promise<Object>} Map of component type to HTML template
 */
export async function generateTemplates(cmsSchema) {
  try {
    // Load design tokens
    const designTokensPath = path.join(__dirname, '..', 'design-tokens.css');
    const designTokens = await fs.readFile(designTokensPath, 'utf-8');

    // Get unique component types needed for this page
    const webparts = cmsSchema.DynamicProperties.Webparts || [];
    const uniqueTypes = [...new Map(webparts.map(wp => [wp.type, wp])).values()];

    console.log(`Component types needed: ${uniqueTypes.map(w => w.type).join(', ')}`);

    const templateMap = {};

    for (const webpart of uniqueTypes) {
      templateMap[webpart.type] = await getTemplate(
        webpart.type,
        webpart.data,
        designTokens
      );
    }

    return templateMap;
  } catch (error) {
    console.error('ERROR in ai-generator:', error);
    throw error;
  }
}

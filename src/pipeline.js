import { runImporter } from './importer.js';
import { generateTemplates } from './ai-generator.js';
import { renderPage } from './renderer.js';
import fetch from 'node-fetch';

// CLI arguments
const [,,
  inputPath  = 'input.json',
  outputJson = 'generated/output.json',
  outputHtml = 'generated/page1.html'
] = process.argv;

/**
 * Run the full AEM to CMS migration pipeline
 */
async function runPipeline() {
  try {
    // Check Ollama availability
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
    console.log();

    console.log('═══════════════════════════════════════════');
    console.log('  ✅ Done!');
    console.log(`  CMS Schema  → ${outputJson}`);
    console.log(`  Rendered    → ${outputHtml}`);
    console.log(`  Registry    → component-registry/ (${Object.keys(templateMap).length} templates)`);
    console.log('═══════════════════════════════════════════\n');
  } catch (error) {
    console.error('\n❌ Pipeline Error:', error.message);
    process.exit(1);
  }
}

runPipeline();

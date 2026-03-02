import Handlebars from 'handlebars';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Render a single webpart using its template
 * @param {Object} webpart - The webpart object with type and data
 * @param {Object} templateMap - Map of component type to HTML template
 * @returns {string} Rendered HTML
 */
function renderWebpart(webpart, templateMap) {
  const { type, data } = webpart;

  if (!templateMap[type]) {
    // Fallback: render a plain div with all data fields
    console.warn(`  ⚠ No template found for '${type}', using fallback`);
    return renderFallback(type, data);
  }

  try {
    const template = Handlebars.compile(templateMap[type]);
    return template(data);
  } catch (error) {
    console.error(`  ERROR rendering ${type}:`, error.message);
    return renderFallback(type, data);
  }
}

/**
 * Fallback renderer for missing templates
 * @param {string} componentType - Component type
 * @param {Object} data - Component data
 * @returns {string} Simple HTML representation
 */
function renderFallback(componentType, data) {
  let html = `<div class="${componentType}-component" style="padding: var(--space-lg); border: 1px solid var(--color-bg-alt);">
    <h3>${componentType}</h3>`;

  for (const [key, value] of Object.entries(data)) {
    const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
    html += `<p><strong>${key}:</strong> ${displayValue}</p>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Render the full page
 * @param {Object} cmsSchema - CMS schema with page metadata and webparts
 * @param {Object} templateMap - Map of component type to HTML template
 * @param {string} outputHtmlPath - Path where to write the HTML file
 * @returns {Promise<void>}
 */
export async function renderPage(cmsSchema, templateMap, outputHtmlPath) {
  try {
    const webparts = cmsSchema.DynamicProperties.Webparts || [];
    const pageTitle = cmsSchema.DynamicProperties.pageTitle || 'Page';

    // Sort webparts by order
    const sortedWebparts = [...webparts].sort((a, b) => a.order - b.order);

    // Render each webpart
    const renderedComponents = sortedWebparts
      .map(webpart => renderWebpart(webpart, templateMap))
      .join('\n');

    // Build full page HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <link rel="stylesheet" href="../design-tokens.css">
  <style>
    body {
      font-family: var(--font-family-base);
      color: var(--color-text);
      background-color: var(--color-bg);
      margin: 0;
      padding: 0;
    }
    .page-container {
      max-width: var(--max-width);
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="page-container">
${renderedComponents.split('\n').map(line => '    ' + line).join('\n')}
  </div>
</body>
</html>`;

    // Write to specified output path
    const outputPath = outputHtmlPath.startsWith('/') ? outputHtmlPath : path.join(__dirname, '..', outputHtmlPath);
    const outputDir = path.dirname(outputPath);
    await fs.ensureDir(outputDir);
    await fs.writeFile(outputPath, html);

    console.log(`  ✓ Page rendered`);
  } catch (error) {
    console.error('ERROR in renderer:', error);
    throw error;
  }
}

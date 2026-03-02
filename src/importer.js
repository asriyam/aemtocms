import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Extract items from itemN pattern (item0, item1, item2, etc.)
 * @param {Object} node - The parent node containing itemN children
 * @returns {Array} Array of extracted items
 */
function extractItems(node) {
  const items = [];
  let index = 0;

  while (`item${index}` in node) {
    items.push(node[`item${index}`]);
    index++;
  }

  return items;
}

/**
 * Remap AEM paths to CMS paths
 * @param {string} value - The path value
 * @returns {string} Remapped path
 */
function remapPaths(value) {
  if (typeof value !== 'string') return value;

  const mappings = [
    { from: '/content/dam/mysite/', to: '/assets/' },
    { from: '/content/mysite/en/', to: '/' }
  ];

  let result = value;
  for (const mapping of mappings) {
    result = result.replace(mapping.from, mapping.to);
  }

  return result;
}

/**
 * Strip JCR/Sling/CQ internal keys
 * @param {Object} node - The node to clean
 * @returns {Object} Cleaned node
 */
function cleanFields(node) {
  const cleaned = {};

  for (const [key, value] of Object.entries(node)) {
    // Skip internal keys and item patterns
    if (key.startsWith('jcr:') || key.startsWith('sling:') || key.startsWith('cq:') || /^item\d+$/.test(key)) {
      continue;
    }

    // Remap paths in string values
    if (typeof value === 'string') {
      cleaned[key] = remapPaths(value);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

/**
 * Recursively walk nodes and collect content components
 * @param {Object} node - The node to walk
 * @param {number} orderCounter - Current order counter
 * @returns {Object} { webparts: [], nextOrder: number }
 */
function walkNodes(node, orderCounter = 1) {
  const webparts = [];
  let nextOrder = orderCounter;

  if (!node || typeof node !== 'object') {
    return { webparts, nextOrder };
  }

  for (const [key, child] of Object.entries(node)) {
    // Skip internal keys
    if (key.startsWith('jcr:') || key.startsWith('sling:') || key.startsWith('cq:')) {
      continue;
    }

    if (typeof child !== 'object' || !child) {
      continue;
    }

    const resourceType = child['sling:resourceType'] || '';

    // Skip responsivegrid components
    if (resourceType.includes('responsivegrid')) {
      continue;
    }

    // Process content components
    if (resourceType.includes('mysite/components/content/')) {
      const type = resourceType.split('/').pop();
      const data = cleanFields(child);

      // Convert itemN patterns to arrays
      if (type === 'card-list') {
        const items = extractItems(child);
        const cleanedItems = items.map(item => cleanFields(item));
        data.items = cleanedItems;
      } else if (type === 'teaser') {
        const actions = extractItems(child);
        const cleanedActions = actions.map(action => cleanFields(action));
        if (cleanedActions.length > 0) {
          data.actions = cleanedActions;
        }
      }

      webparts.push({
        type,
        order: nextOrder,
        data
      });

      nextOrder++;
    } else if (!resourceType) {
      // Recursively walk nested unstructured nodes
      const { webparts: nestedWebparts, nextOrder: newOrder } = walkNodes(child, nextOrder);
      webparts.push(...nestedWebparts);
      nextOrder = newOrder;
    }
  }

  return { webparts, nextOrder };
}

/**
 * Main importer function
 * @param {string} inputFile - Path to input.json (relative to project root)
 * @param {string} outputFile - Path to output.json (relative to project root)
 * @returns {Promise<Object>} CMS schema object
 */
export async function runImporter(inputFile, outputFile) {
  try {
    // Read input JSON
    const inputPath = inputFile.startsWith('/') ? inputFile : path.join(__dirname, '..', inputFile);
    const input = await fs.readJson(inputPath);

    // Extract page metadata
    const jcrContent = input['jcr:content'] || {};
    const title = jcrContent['jcr:title'] || '';
    const pageTitle = jcrContent['pageTitle'] || '';
    const navTitle = jcrContent['navTitle'] || '';

    // Extract template name (last segment)
    const templatePath = jcrContent['cq:template'] || '';
    const template = templatePath.split('/').pop() || '';

    // Extract and clean tags
    const cqTags = jcrContent['cq:tags'] || [];
    const tags = cqTags.map(tag => {
      // Remove 'mysite:' prefix if present
      return tag.replace('mysite:', '');
    });

    // Walk nodes to extract webparts
    const root = jcrContent.root || {};
    const { webparts } = walkNodes(root, 1);

    // Build CMS schema
    const cmsSchema = {
      Id: 'home',
      key: title,
      DynamicProperties: {
        title,
        pageTitle,
        navTitle,
        template,
        tags,
        Webparts: webparts
      }
    };

    // Write to specified output path
    const outputPath = outputFile.startsWith('/') ? outputFile : path.join(__dirname, '..', outputFile);
    const outputDir = path.dirname(outputPath);
    await fs.ensureDir(outputDir);
    await fs.writeJson(outputPath, cmsSchema, { spaces: 2 });

    console.log(`✓ Importer complete: ${webparts.length} webparts extracted`);
    return cmsSchema;
  } catch (error) {
    console.error('ERROR in importer:', error);
    throw error;
  }
}

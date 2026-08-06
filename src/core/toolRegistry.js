/**
 * Registry for local maintenance tools loaded from src/tools/.
 *
 * Tools are plain modules exporting an object with id, name, description,
 * category, icon, and an async run(args, ctx) function.
 */
const tools = new Map();

/**
 * Register a tool plugin.
 * @param {Object} tool - Tool definition.
 * @param {string} tool.id - Unique tool identifier.
 * @param {string} tool.name - Human-readable name.
 * @param {string} tool.description - Short description.
 * @param {string} [tool.category] - Category slug.
 * @param {string} [tool.icon] - Icon identifier.
 * @param {boolean} [tool.stub] - If true, the tool is not yet implemented.
 * @param {Function} tool.run - Async executor.
 * @throws {Error} If tool is missing or has no id.
 */
function register(tool) {
  if (!tool || !tool.id) {
    throw new Error('Tool plugin is missing a required "id" field');
  }
  if (tools.has(tool.id)) {
    console.warn(`[toolRegistry] Tool id "${tool.id}" registered twice — overwriting`);
  }
  tools.set(tool.id, tool);
}

/**
 * List all registered tools.
 * @returns {Array<Object>} Tool summary objects.
 */
function list() {
  return Array.from(tools.values()).map(({ id, name, description, category, icon, stub }) => ({
    id, name, description, category, icon, stub: !!stub
  }));
}

/**
 * Execute a registered tool.
 * @param {string} toolId - Tool identifier.
 * @param {Object} [args={}] - Tool arguments.
 * @param {Object} [ctx={}] - Execution context (db, eventBus, mainWindow, etc.).
 * @returns {Promise<{ ok: boolean, data?: *, error?: string }>} Execution result.
 */
async function run(toolId, args, ctx) {
  const tool = tools.get(toolId);
  if (!tool) return { ok: false, error: `Unknown tool: ${toolId}` };
  if (tool.stub) return { ok: false, error: `"${tool.name}" is not implemented yet.` };
  try {
    const data = await tool.run(args || {}, ctx || {});
    return { ok: true, data };
  } catch (err) {
    console.error(`[toolRegistry] Tool "${toolId}" threw:`, err);
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { register, list, run };

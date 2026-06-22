// Holds every loaded tool plugin and exposes list()/run() to the IPC layer.
//
// A "tool" is any module matching this shape:
//   {
//     id: "file-scanner",        // unique, stable, used in IPC + UI routing
//     name: "File Scanner",
//     description: "...",
//     category: "Security",      // groups tools in the sidebar/tools page
//     icon: "shield",            // key into the icon set used by the UI
//     run: async (args, ctx) => { ... return result }
//   }
//
// ctx passed to run() currently provides: { sendProgress(payload) }

const tools = new Map();

function register(tool) {
  if (!tool || !tool.id) {
    throw new Error('Tool plugin is missing a required "id" field');
  }
  if (tools.has(tool.id)) {
    console.warn(`[toolRegistry] Tool id "${tool.id}" registered twice — overwriting`);
  }
  tools.set(tool.id, tool);
}

function list() {
  // Only return serializable metadata — never function references — since
  // this crosses the IPC boundary to the renderer.
  return Array.from(tools.values()).map(({ id, name, description, category, icon, stub }) => ({
    id,
    name,
    description,
    category,
    icon,
    stub: !!stub
  }));
}

async function run(toolId, args, ctx) {
  const tool = tools.get(toolId);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${toolId}` };
  }
  if (tool.stub) {
    return { ok: false, error: `"${tool.name}" is not implemented yet.` };
  }
  try {
    const data = await tool.run(args || {}, ctx || {});
    return { ok: true, data };
  } catch (err) {
    console.error(`[toolRegistry] Tool "${toolId}" threw:`, err);
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { register, list, run };

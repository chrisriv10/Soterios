module.exports = {
  id: 'process-viewer',
  name: 'Process Viewer',
  description: 'List running processes with CPU/memory usage.',
  category: 'System',
  icon: 'list',
  run: async () => {
    // ps-list is an ESM module; dynamic import works from CJS in Node 18+
    const { default: psList } = await import('ps-list');
    const processes = await psList();

    return processes
      .map((p) => ({
        pid: p.pid,
        name: p.name,
        cpu: p.cpu !== undefined ? +p.cpu.toFixed(1) : null,
        memory: p.memory !== undefined ? +p.memory.toFixed(1) : null
      }))
      .sort((a, b) => (b.cpu || 0) - (a.cpu || 0));
  }
};

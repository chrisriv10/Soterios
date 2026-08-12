const path = require('path');

jest.useRealTimers();

describe('processViewer IO sampler', () => {
  let origConsoleWarn;
  beforeAll(() => {
    origConsoleWarn = console.warn;
    console.warn = () => {};
  });
  afterAll(() => { console.warn = origConsoleWarn; });

  test('samples process IO and returns disk/network rates', async () => {
    // Mock systeminformation to produce deterministic samples.
    const si = require('systeminformation');
    // First call: procData for run() -> single process list with pid 100
    // Second call: sampler first snapshot
    // Third call: sampler second snapshot with increased counters
    const procList = [{ pid: 100, name: 'procA', path: 'C:\\procA.exe', command: 'procA' }];

    si.processes = jest.fn()
      .mockImplementationOnce(() => Promise.resolve({ list: procList }))
      .mockImplementationOnce(() => Promise.resolve({ list: [{ pid: 100, ioReadBytes: 1000, ioWriteBytes: 2000, ioOtherBytes: 50 }] }))
      .mockImplementationOnce(() => Promise.resolve({ list: [{ pid: 100, ioReadBytes: 6000, ioWriteBytes: 8000, ioOtherBytes: 250 }] }));

    si.currentLoad = jest.fn(() => Promise.resolve({ currentLoad: 12 }));
    si.mem = jest.fn(() => Promise.resolve({ total: 1000, available: 500 }));

    // Require the module under test
    const viewer = require(path.join(__dirname, '..', 'src', 'tools', 'processViewer.js'));

    const result = await viewer.run({}, {});
    expect(result).toHaveProperty('processes');
    const p = result.processes.find((x) => x.pid === 100);
    expect(p).toBeDefined();
    // diskIo should be roughly ( (6000-1000) + (8000-2000) ) / seconds
    // sampleInterval in code is 500ms -> seconds = 0.5 -> rates are (5000/0.5)=10000 read, (6000/0.5)=12000 write -> sum 22000
    expect(p.diskIo).toBeGreaterThan(20000);
    // other rate should be (250-50)/0.5 = 400
    expect(p.networkIo).toBeGreaterThan(300);
  }, 20000);
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('splash progress sequencing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function bootstrapSplash() {
    const html = fs.readFileSync(path.join(__dirname, '../src/ui/pages/splash.html'), 'utf8');
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Splash script not found');

    const listeners = {};
    const label = { textContent: 'Starting Soterios...' };
    const fill = { style: {} };
    const readyShown = jest.fn();

    const context = {
      console,
      document: {
        documentElement: { setAttribute: jest.fn() },
        getElementById: (id) => {
          if (id === 'progressFill') return fill;
          if (id === 'progressLabel') return label;
          return null;
        }
      },
      URLSearchParams,
      Date,
      setTimeout,
      clearTimeout,
      window: {
        location: { search: '' },
        api: {
          on: (eventName, cb) => {
            listeners[eventName] = cb;
          },
          readyShown
        }
      }
    };

    vm.runInNewContext(match[1], context);
    return { label, fill, listeners, readyShown };
  }

  it('jumps to the latest label when a burst arrives faster than the hold time', () => {
    const { listeners, label } = bootstrapSplash();

    listeners['splash:progress']({ label: 'Loading quarantine...', pct: 55 });
    listeners['splash:progress']({ label: 'Finalizing dashboard...', pct: 97 });
    listeners['splash:progress']({ label: 'Ready', pct: 100 });

    // First label shows immediately; the burst replaces it with the newest.
    expect(label.textContent).toBe('Loading quarantine...');

    // Hold expires: the latest label (Ready) is shown, stale middle skipped.
    jest.advanceTimersByTime(500);
    expect(label.textContent).toBe('Ready');

    // Ready stays up for its own full hold.
    jest.advanceTimersByTime(500);
    expect(label.textContent).toBe('Ready');
  });

  it('keeps every label when they arrive slower than the hold time', () => {
    const { listeners, label } = bootstrapSplash();

    listeners['splash:progress']({ label: 'Loading quarantine...', pct: 55 });
    expect(label.textContent).toBe('Loading quarantine...');

    jest.advanceTimersByTime(600);
    listeners['splash:progress']({ label: 'Finalizing dashboard...', pct: 97 });
    expect(label.textContent).toBe('Finalizing dashboard...');

    jest.advanceTimersByTime(600);
    listeners['splash:progress']({ label: 'Ready', pct: 100 });
    expect(label.textContent).toBe('Ready');

    jest.advanceTimersByTime(500);
    expect(label.textContent).toBe('Ready');
  });

  it('notifies main only after Ready has been displayed for its beat', () => {
    const { listeners, readyShown } = bootstrapSplash();

    listeners['splash:progress']({ label: 'Ready', pct: 100 });

    expect(readyShown).not.toHaveBeenCalled();

    jest.advanceTimersByTime(300);
    expect(readyShown).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(readyShown).toHaveBeenCalledTimes(1);
  });

  it('updates the progress bar for label-less messages immediately', () => {
    const { listeners, fill } = bootstrapSplash();

    listeners['splash:progress']({ pct: 42 });
    expect(fill.style.width).toBe('42%');
  });
});

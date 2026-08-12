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
          }
        }
      }
    };

    vm.runInNewContext(match[1], context);
    return { label, fill, listeners };
  }

  it('keeps the final ready state behind queued startup labels', () => {
    const { listeners, label } = bootstrapSplash();

    listeners['splash:progress']({ label: 'Loading quarantine...', pct: 55 });
    listeners['splash:progress']({ label: 'Finalizing dashboard...', pct: 97 });
    listeners['splash:progress']({ label: 'Ready', pct: 100 });

    expect(label.textContent).toBe('Loading quarantine...');

    jest.advanceTimersByTime(500);
    expect(label.textContent).toBe('Finalizing dashboard...');

    jest.advanceTimersByTime(500);
    expect(label.textContent).toBe('Ready');
  });
});

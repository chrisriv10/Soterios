const HIBP_API = 'https://api.pwnedpasswords.com/range/';

async function sha1(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function checkPwned(password) {
  const hash = await sha1(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const resp = await fetch(`${HIBP_API}${prefix}`);
  const text = await resp.text();
  const lines = text.trim().split('\n');
  for (const line of lines) {
    const [suf, count] = line.split(':');
    if (suf === suffix) return parseInt(count, 10);
  }
  return 0;
}

function showResult(count) {
  const result = document.getElementById('result');
  if (count === 0) {
    result.className = 'result safe';
    result.innerHTML = `
      <div class="result-title">✓ Not found in breaches</div>
      <div class="result-detail">This password was not found in the HIBP database (${count} occurrences).</div>
    `;
  } else {
    result.className = 'result pwned';
    result.innerHTML = `
      <div class="result-title">⚠ Found in ${count} breach${count > 1 ? 'es' : ''}</div>
      <div class="result-detail">This password appears in known data breaches. <strong>Do not use it.</strong> Generate a new one in the Soterios app.</div>
    `;
  }
  result.style.display = 'block';
}

async function checkConnection() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const resp = await fetch('http://localhost:17234/api/health', { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      document.getElementById('statusDot').classList.remove('offline');
      document.getElementById('statusText').textContent = 'Soterios app connected';
    } else throw new Error();
  } catch {
    document.getElementById('statusDot').classList.add('offline');
    document.getElementById('statusText').textContent = 'Soterios app not running';
  }
}

document.getElementById('checkBtn').addEventListener('click', async () => {
  const input = document.getElementById('passwordInput');
  const btn = document.getElementById('checkBtn');
  const loader = document.getElementById('loader');
  const pwd = input.value;

  if (!pwd) return;

  btn.disabled = true;
  loader.classList.add('active');
  document.getElementById('result').style.display = 'none';

  try {
    const count = await checkPwned(pwd);
    showResult(count);
  } catch (e) {
    document.getElementById('result').className = 'result pwned';
    document.getElementById('result').innerHTML = '<div class="result-title">Error</div><div class="result-detail">Could not check password.</div>';
    document.getElementById('result').style.display = 'block';
  } finally {
    btn.disabled = false;
    loader.classList.remove('active');
  }
});

document.getElementById('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

checkConnection();
setInterval(checkConnection, 30000);
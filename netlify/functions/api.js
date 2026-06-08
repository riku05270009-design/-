const fs = require('fs');

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'sinagawa5195';
const DATA_FILE = '/tmp/expenses.json';

function loadExpenses() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function saveExpenses(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function parseMultipart(body, contentType) {
  const m = contentType.match(/boundary=([^\s;]+)/);
  if (!m) return {};
  const boundary = m[1];
  const result = {};
  const parts = body.split(new RegExp('--' + boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const part of parts) {
    const match = part.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="[^"]*")?\r?\n(?:Content-Type:[^\r\n]*\r?\n)?\r?\n([\s\S]*?)\r?\n$/);
    if (match && !part.match(/Content-Type: (?!text)/)) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

async function parseBody(event) {
  const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '');
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString()
    : (event.body || '');

  if (ct.includes('multipart/form-data')) {
    return parseMultipart(raw, ct);
  }
  try { return JSON.parse(raw); } catch { return {}; }
}

async function fetchUSDJPY(date) {
  const https = require('https');
  const tryFetch = (url) => new Promise((resolve) => {
    const req = https.get(url, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)?.rates?.JPY ?? null); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });

  // 指定日で取得、失敗したら最新レートを使用
  const rate = await tryFetch(`https://api.frankfurter.app/${date}?from=USD&to=JPY`);
  if (rate) return rate;
  return await tryFetch(`https://api.frankfurter.app/latest?from=USD&to=JPY`);
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
};

exports.handler = async (event) => {
  const method = event.httpMethod;
  const p = event.path || '/';

  if (method === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const token = event.headers['x-auth-token'] || event.headers['X-Auth-Token'] || '';
  const isAuthed = token === AUTH_PASSWORD;

  // POST /api/login
  if (method === 'POST' && p.includes('/api/login')) {
    const body = await parseBody(event);
    if (body.password === AUTH_PASSWORD) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true, token: AUTH_PASSWORD }) };
    }
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'パスワードが違います' }) };
  }

  // GET /api/expenses
  if (method === 'GET' && p.includes('/api/expenses') && !p.match(/\/api\/expenses\/\d/)) {
    if (!isAuthed) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: '認証が必要です' }) };
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(loadExpenses()) };
  }

  // POST /api/expenses
  if (method === 'POST' && p.includes('/api/expenses')) {
    if (!isAuthed) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: '認証が必要です' }) };
    const body = await parseBody(event);
    const { user, amount, date, description, note, category } = body;
    if (!user || !amount || !date || !description || !category) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: '必須項目が不足しています' }) };
    }
    const entry = {
      id: Date.now(), user, amount, date, description,
      note: note || '', category, createdAt: new Date().toISOString()
    };
    const usdMatch = String(amount).match(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)/i);
    if (usdMatch) {
      const usdAmount = parseFloat(usdMatch[1].replace(/,/g, ''));
      const rate = await fetchUSDJPY(date);
      if (rate) { entry.usdAmount = usdAmount; entry.usdRate = rate; entry.jpyAmount = Math.round(usdAmount * rate); }
    }
    const expenses = loadExpenses();
    expenses.push(entry);
    saveExpenses(expenses);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true, entry }) };
  }

  // DELETE /api/expenses/:id
  if (method === 'DELETE' && p.includes('/api/expenses/')) {
    if (!isAuthed) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: '認証が必要です' }) };
    const id = Number(p.split('/').pop());
    saveExpenses(loadExpenses().filter(e => e.id !== id));
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found', path: p }) };
};

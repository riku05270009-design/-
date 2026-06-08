const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const multer = require('multer');
const { appendExpense } = require('./sheets');

// .env 読み込み
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

function getPassword() {
  return process.env.AUTH_PASSWORD || '';
}

function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  const pw = getPassword();
  if (pw && token === pw) return next();
  res.status(401).json({ error: '認証が必要です' });
}

const IS_NETLIFY = !!process.env.NETLIFY;
const DATA_FILE = IS_NETLIFY ? '/tmp/expenses.json' : path.join(__dirname, 'expenses.json');
const UPLOADS_DIR = IS_NETLIFY ? '/tmp/uploads' : path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)|application\/pdf$/.test(file.mimetype);
    cb(ok ? null : new Error('画像またはPDFのみ対応'), ok);
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

function loadExpenses() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}

function saveExpenses(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function parseUSD(str) {
  const m = String(str).match(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)|(?:([\d,]+(?:\.\d+)?)\s*USD)/i);
  if (!m) return null;
  return parseFloat((m[1] || m[2]).replace(/,/g, ''));
}

function fetchJSON(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve);
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

async function fetchUSDJPY(date) {
  const json = await fetchJSON(`https://api.frankfurter.app/${date}?from=USD&to=JPY`);
  return json?.rates?.JPY ?? null;
}

app.get('/api/debug-pw', (req, res) => {
  const pw = process.env.AUTH_PASSWORD;
  res.json({ length: pw ? pw.length : 0, set: !!pw });
});

app.post('/api/login', (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const pw = getPassword();
  if (!pw) return res.status(500).json({ error: 'サーバー設定エラー' });
  if (body && body.password === pw) {
    res.json({ success: true, token: pw });
  } else {
    res.status(401).json({ error: 'パスワードが違います' });
  }
});

app.get('/api/expenses', requireAuth, (req, res) => {
  res.json(loadExpenses());
});

app.post('/api/expenses', requireAuth, upload.single('receipt'), async (req, res) => {
  const { user, amount, date, description, note, category } = req.body;
  if (!user || !amount || !date || !description || !category) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: '必須項目が不足しています' });
  }

  const newEntry = {
    id: Date.now(),
    user, amount, date, description,
    note: note || '',
    category,
    createdAt: new Date().toISOString()
  };

  if (req.file) {
    newEntry.receipt = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      url: `/uploads/${req.file.filename}`
    };
  }

  const usdAmount = parseUSD(amount);
  if (usdAmount !== null) {
    const rate = await fetchUSDJPY(date);
    if (rate !== null) {
      newEntry.usdAmount = usdAmount;
      newEntry.usdRate = rate;
      newEntry.jpyAmount = Math.round(usdAmount * rate);
    }
  }

  const expenses = loadExpenses();
  expenses.push(newEntry);
  saveExpenses(expenses);
  appendExpense(newEntry); // Googleスプレッドシートにも追記（非同期・失敗しても申請は通る）
  res.json({ success: true, entry: newEntry });
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const expenses = loadExpenses();
  const target = expenses.find(e => e.id === id);
  if (!target) return res.status(404).json({ error: '該当データなし' });

  if (target.receipt) {
    const filePath = path.join(UPLOADS_DIR, target.receipt.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  saveExpenses(expenses.filter(e => e.id !== id));
  res.json({ success: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`経費管理ツール起動中: http://localhost:${PORT}`);
  });
}

module.exports = app;

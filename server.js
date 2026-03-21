// ═══════════════════════════════════════════════════
// NeuralCode — Backend Server
// AI Engine: Groq (llama-3.3-70b) — fast & free
// ═══════════════════════════════════════════════════

const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const fetch    = require('node-fetch');
require('dotenv').config();

const app = express();

// ── MIDDLEWARE ───────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── MONGODB CONNECTION ───────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── USER SCHEMA ──────────────────────────────────
const UserSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  password:  { type: String, required: true },
  role:      { type: String, default: 'student' },
  xp:        { type: Number, default: 0 },
  streak:    { type: Number, default: 1 },
  stats:     { type: [Number], default: [0, 0, 0, 0] },
  progress:  { type: [Number], default: [0, 0, 0, 0] },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// ── HELPERS ──────────────────────────────────────
const SECRET = process.env.JWT_SECRET || 'neuralcode-secret-change-in-prod';

function makeToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, name: user.name },
    SECRET,
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function safeParseJSON(rawStr) {
  try {
    let clean = rawStr.replace(/```json|```/g, '').trim();
    const firstBracket = clean.indexOf('[');
    const firstBrace   = clean.indexOf('{');
    let startIdx = -1, endIdx = -1;
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      startIdx = firstBracket;
      endIdx   = clean.lastIndexOf(']') + 1;
    } else if (firstBrace !== -1) {
      startIdx = firstBrace;
      endIdx   = clean.lastIndexOf('}') + 1;
    }
    if (startIdx === -1 || endIdx <= startIdx) return JSON.parse(clean);
    return JSON.parse(clean.substring(startIdx, endIdx));
  } catch (e) {
    throw new Error('Failed to parse AI response as JSON');
  }
}

// ══════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════

app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(409).json({ error: 'An account with this email already exists' });

    const hashed = await bcrypt.hash(password, 12);
    const user   = await User.create({ name, email, password: hashed, role: role || 'student' });

    res.status(201).json({
      message: 'Account created successfully',
      token: makeToken(user),
      user: { name: user.name, email: user.email, xp: 0, streak: 1, stats: [0,0,0,0], progress: [0,0,0,0] }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid credentials' });

    res.json({
      token: makeToken(user),
      user: {
        name: user.name, email: user.email,
        xp: user.xp, streak: user.streak,
        stats: user.stats, progress: user.progress
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.get('/auth/me', authRequired, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  res.json(user);
});

// ══════════════════════════════════════════════════
// USER ROUTES
// ══════════════════════════════════════════════════

// ── PATCH /user/progress ─────────────────────────  ← NEW: was missing
app.patch('/user/progress', authRequired, async (req, res) => {
  try {
    const { xp, stats, progress, streak } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { xp, stats, progress, streak },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// ══════════════════════════════════════════════════
// GROQ AI CONFIG
// ══════════════════════════════════════════════════

const GROQ_KEY   = process.env.GROQ_API_KEY;
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function callGroq(systemPrompt, userPrompt) {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROQ_KEY
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ],
      max_tokens: 1500,
      temperature: 0.5
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// ══════════════════════════════════════════════════
// AI ROUTES
// ══════════════════════════════════════════════════

// ── POST /api/chat ───────────────────────────────  ← NEW: was missing
app.post('/api/chat', authRequired, async (req, res) => {
  try {
    const { systemPrompt, userMessage } = req.body;
    if (!userMessage)
      return res.status(400).json({ error: 'userMessage is required' });

    const system = systemPrompt || 'You are a helpful coding mentor for beginners. Explain everything clearly with examples.';
    const reply  = await callGroq(system, userMessage);
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Chat failed. Please try again.' });
  }
});

// ── POST /api/quiz ───────────────────────────────
app.post('/api/quiz', authRequired, async (req, res) => {
  try {
    const { topic } = req.body;
    const system = 'You are a quiz generator. Return ONLY a raw JSON array.';
    const prompt = `Create exactly 5 beginner-level multiple choice quiz questions about: "${topic}"
Return ONLY this JSON array format:
[{"q":"question","options":["A) op","B) op","C) op","D) op"],"correct":0,"explain":"text"}]`;

    const raw       = await callGroq(system, prompt);
    const questions = safeParseJSON(raw);
    res.json({ questions });
  } catch (err) {
    console.error('Quiz error:', err.message);
    res.status(500).json({ error: 'The AI had a hiccup generating the quiz. Please try again.' });
  }
});

// ── POST /api/review ─────────────────────────────
app.post('/api/review', authRequired, async (req, res) => {
  try {
    const { code, lang, beginner, rewrite, desc } = req.body;
    const system = 'You are a code reviewer. Return ONLY raw JSON.';
    const prompt = `Review this ${lang || 'JavaScript'} code.
Respond ONLY with this JSON format:
{"overall":75,"grade":"B","metrics":{"readability":80,"correctness":70,"bestPractices":65},"issues":[{"type":"good","text":"text"}],"summary":"text"${rewrite ? ',"rewrite":"code"' : ''}}
Code:
${code}`;

    const raw    = await callGroq(system, prompt);
    const review = safeParseJSON(raw);
    res.json({ review });
  } catch (err) {
    console.error('Review error:', err.message);
    res.status(500).json({ error: 'Review failed. The AI response was malformed.' });
  }
});

// ── 404 CATCH-ALL ────────────────────────────────  ← NEW: helps debug missing routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/user')) {
    return res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  }
  next();
});

// ── STATIC FILES (must be LAST) ──────────────────  ← FIXED: moved below all routes
app.use(express.static('Public'));

// ── START ─────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 NeuralCode server running on http://localhost:${PORT}`);
});
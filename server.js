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
app.use(express.static('Public'));

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

// ── JWT HELPER ───────────────────────────────────
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

// ══════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════

app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Invalid email format' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

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
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ error: 'No account found with this email' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ error: 'Incorrect password' });

    res.json({
      token: makeToken(user),
      user: {
        name: user.name, email: user.email,
        xp: user.xp, streak: user.streak,
        stats: user.stats, progress: user.progress
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.get('/auth/me', authRequired, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ══════════════════════════════════════════════════
// USER PROGRESS
// ══════════════════════════════════════════════════

app.patch('/user/progress', authRequired, async (req, res) => {
  try {
    const { xp, stats, progress, streak } = req.body;
    const update = {};
    if (xp       !== undefined) update.xp       = xp;
    if (stats     !== undefined) update.stats    = stats;
    if (progress  !== undefined) update.progress = progress;
    if (streak    !== undefined) update.streak   = streak;
    await User.findByIdAndUpdate(req.user.id, update);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// ══════════════════════════════════════════════════
// GROQ AI — replaces Gemini
// Model: llama-3.3-70b-versatile (free, fast, powerful)
// ══════════════════════════════════════════════════

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
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
      max_tokens: 1000,
      temperature: 0.7
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : null;
  if (!text) throw new Error('Empty response from Groq');
  return text;
}

// ── POST /api/chat ───────────────────────────────
app.post('/api/chat', authRequired, async (req, res) => {
  try {
    const { systemPrompt, userMessage } = req.body;
    if (!userMessage) return res.status(400).json({ error: 'userMessage is required' });
    const reply = await callGroq(systemPrompt, userMessage);
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/quiz ───────────────────────────────
app.post('/api/quiz', authRequired, async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const system = 'You are a quiz generator. Return ONLY a raw JSON array with no markdown fences, no explanation, nothing else before or after the array.';
    const prompt = `Create exactly 5 beginner-level multiple choice quiz questions about: "${topic}"
Return ONLY this JSON array format:
[{"q":"question text","options":["A) option","B) option","C) option","D) option"],"correct":0,"explain":"simple beginner-friendly explanation"}]
Rules: correct is 0-indexed. No trick questions. Simple language only.`;

    const raw = (await callGroq(system, prompt)).replace(/```json|```/g, '').trim();
    const questions = JSON.parse(raw);
    res.json({ questions });
  } catch (err) {
    console.error('Quiz error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/review ─────────────────────────────
app.post('/api/review', authRequired, async (req, res) => {
  try {
    const { code, lang, beginner, rewrite, desc } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });

    const system = 'You are a code reviewer. Return ONLY raw JSON with no markdown fences, no explanation, nothing else.';
    const prompt = `Review this ${lang || 'JavaScript'} code written by a beginner student.
${beginner ? 'Explain ALL feedback in simple beginner-friendly language. Define any technical terms.' : ''}
Respond ONLY with this JSON format:
{"overall":75,"grade":"B","metrics":{"readability":80,"correctness":70,"bestPractices":65},"issues":[{"type":"good","text":"something positive"},{"type":"warn","text":"something to improve"},{"type":"bad","text":"a bug or problem"}],"summary":"2 encouraging sentences"${rewrite ? ',"rewrite":"the improved code as a string"' : ''}}
${desc ? 'Context about this code: ' + desc : ''}
Code to review:
${code}`;

    const raw = (await callGroq(system, prompt)).replace(/```json|```/g, '').trim();
    const review = JSON.parse(raw);
    res.json({ review });
  } catch (err) {
    console.error('Review error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── START ─────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 NeuralCode server running on http://localhost:${PORT}`);
  console.log(`🤖 AI engine: Groq (${GROQ_MODEL})`);
});

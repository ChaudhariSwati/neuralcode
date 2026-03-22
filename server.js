// ═══════════════════════════════════════════════════
// NeuralCode — Backend Server (Improved)
// AI Engine: Groq (llama-3.3-70b)
// Improvements: security, input validation, logging
// ═══════════════════════════════════════════════════

const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const fetch    = require('node-fetch');
require('dotenv').config();

const app = express();

// ── SECURITY CHECK ON STARTUP ────────────────────
const REQUIRED_ENV = ['MONGO_URI', 'GROQ_API_KEY', 'JWT_SECRET'];
REQUIRED_ENV.forEach(key => {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
});

const SECRET = process.env.JWT_SECRET;

// ── MIDDLEWARE ───────────────────────────────────
// Allow all origins — safe because all AI routes require JWT auth
// The API key never leaves the server regardless of CORS setting
app.use(cors({
  origin: true,
  credentials: true
}));

// Limit request body size to prevent abuse
app.use(express.json({ limit: '50kb' }));

// ── STATIC FILES ─────────────────────────────────
// Serve frontend BEFORE request logger to avoid noise
app.use(express.static('Public'));

// ── REQUEST LOGGER ───────────────────────────────
app.use((req, res, next) => {
  // Only log API and auth routes — skip static file requests
  if (!req.path.startsWith('/api') && !req.path.startsWith('/auth') && !req.path.startsWith('/user')) {
    return next();
  }
  const start = Date.now();
  res.on('finish', () => {
    const ms    = Date.now() - start;
    const color = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
    console.log(`${color}[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)\x1b[0m`);
  });
  next();
});

// ── MONGODB CONNECTION ───────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// ── USER SCHEMA ──────────────────────────────────
const UserSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true, maxlength: 100 },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  role:      { type: String, default: 'student', enum: ['student', 'self', 'career', 'other'] },
  xp:        { type: Number, default: 0, min: 0 },
  streak:    { type: Number, default: 1, min: 0 },
  stats:     { type: [Number], default: [0, 0, 0, 0] },
  progress:  { type: [Number], default: [0, 0, 0, 0] },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// ── HELPERS ──────────────────────────────────────
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
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    res.status(401).json({ error: 'Invalid token. Please sign in again.' });
  }
}

function validateFields(fields, body) {
  for (const [key, rules] of Object.entries(fields)) {
    const val = body[key];
    if (rules.required && (val === undefined || val === null || val === ''))
      return `${key} is required`;
    if (val !== undefined) {
      if (rules.minLength && String(val).length < rules.minLength)
        return `${key} must be at least ${rules.minLength} characters`;
      if (rules.maxLength && String(val).length > rules.maxLength)
        return `${key} must be under ${rules.maxLength} characters`;
      if (rules.isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val))
        return `${key} must be a valid email address`;
    }
  }
  return null;
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

    const err = validateFields({
      name:     { required: true, minLength: 2, maxLength: 100 },
      email:    { required: true, isEmail: true },
      password: { required: true, minLength: 6, maxLength: 128 }
    }, req.body);
    if (err) return res.status(400).json({ error: err });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing)
      return res.status(409).json({ error: 'An account with this email already exists' });

    const hashed = await bcrypt.hash(password, 12);
    const user   = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashed,
      role: role || 'student'
    });

    console.log(`✅ New user registered: ${user.email}`);

    res.status(201).json({
      message: 'Account created successfully',
      token: makeToken(user),
      user: { name: user.name, email: user.email, xp: 0, streak: 1, stats: [0,0,0,0], progress: [0,0,0,0] }
    });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Server error during registration. Please try again.' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const err = validateFields({
      email:    { required: true, isEmail: true },
      password: { required: true }
    }, req.body);
    if (err) return res.status(400).json({ error: err });

    const user = await User.findOne({ email: email.toLowerCase() });

    // Constant-time compare prevents timing attacks
    const passwordMatch = user ? await bcrypt.compare(password, user.password) : false;
    if (!user || !passwordMatch)
      return res.status(401).json({ error: 'Invalid email or password' });

    console.log(`✅ User logged in: ${user.email}`);

    res.json({
      token: makeToken(user),
      user: {
        name: user.name, email: user.email,
        xp: user.xp, streak: user.streak,
        stats: user.stats, progress: user.progress
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error during login. Please try again.' });
  }
});

app.get('/auth/me', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Auth/me error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// ══════════════════════════════════════════════════
// USER ROUTES
// ══════════════════════════════════════════════════

app.patch('/user/progress', authRequired, async (req, res) => {
  try {
    const { xp, stats, progress, streak } = req.body;

    if (xp !== undefined && (typeof xp !== 'number' || xp < 0))
      return res.status(400).json({ error: 'Invalid XP value' });
    if (stats && (!Array.isArray(stats) || stats.length !== 4))
      return res.status(400).json({ error: 'Stats must be an array of 4 numbers' });
    if (progress && (!Array.isArray(progress) || progress.length !== 4))
      return res.status(400).json({ error: 'Progress must be an array of 4 numbers' });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { xp, stats, progress, streak },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Progress save error:', err.message);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// ══════════════════════════════════════════════════
// GROQ AI
// ══════════════════════════════════════════════════

const GROQ_KEY   = process.env.GROQ_API_KEY;
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function callGroq(systemPrompt, userPrompt) {
  let response;
  try {
    response = await fetch(GROQ_URL, {
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
  } catch (networkErr) {
    throw new Error('Could not reach Groq API. Check your internet connection.');
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error('Groq API error:', errText);
    throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// ── POST /api/chat ───────────────────────────────
app.post('/api/chat', authRequired, async (req, res) => {
  try {
    const { systemPrompt, userMessage } = req.body;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length < 2)
      return res.status(400).json({ error: 'Please enter a message' });
    if (userMessage.length > 2000)
      return res.status(400).json({ error: 'Message is too long (max 2000 characters)' });

    const system = systemPrompt || 'You are a helpful coding mentor for beginners.';
    const reply  = await callGroq(system, userMessage.trim());
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message || 'Chat failed. Please try again.' });
  }
});

// ── POST /api/quiz ───────────────────────────────
app.post('/api/quiz', authRequired, async (req, res) => {
  try {
    const { topic } = req.body;

    if (!topic || typeof topic !== 'string' || topic.trim().length < 3)
      return res.status(400).json({ error: 'A valid topic is required' });
    if (topic.length > 200)
      return res.status(400).json({ error: 'Topic is too long (max 200 characters)' });

    const system = 'You are a quiz generator. Return ONLY a raw JSON array with no markdown fences.';
    const prompt = `Create exactly 5 beginner-level multiple choice quiz questions about: "${topic.trim()}"
Return ONLY this JSON array format with no extra text:
[{"q":"question","options":["A) op","B) op","C) op","D) op"],"correct":0,"explain":"text"}]`;

    const raw       = await callGroq(system, prompt);
    const questions = safeParseJSON(raw);

    if (!Array.isArray(questions) || questions.length === 0)
      return res.status(500).json({ error: 'AI returned invalid quiz data. Please try again.' });

    res.json({ questions });
  } catch (err) {
    console.error('Quiz error:', err.message);
    res.status(500).json({ error: err.message || 'Quiz generation failed. Please try again.' });
  }
});

// ── POST /api/review ─────────────────────────────
app.post('/api/review', authRequired, async (req, res) => {
  try {
    const { code, lang, rewrite, desc } = req.body;

    if (!code || typeof code !== 'string' || code.trim().length < 5)
      return res.status(400).json({ error: 'Please provide some code to review' });
    if (code.length > 10000)
      return res.status(400).json({ error: 'Code is too long (max 10,000 characters)' });

    const system = 'You are a code reviewer. Return ONLY raw JSON with no markdown fences.';
    const prompt = `Review this ${lang || 'JavaScript'} code written by a beginner.
Respond ONLY with this JSON (no markdown, no extra text):
{"overall":75,"grade":"B","metrics":{"readability":80,"correctness":70,"bestPractices":65},"issues":[{"type":"good","text":"positive feedback"},{"type":"warn","text":"suggestion"},{"type":"bad","text":"bug"}],"summary":"2 sentence summary"${rewrite ? ',"rewrite":"improved code"' : ''}}
Code:
${code.trim()}
${desc ? `\nContext: ${desc}` : ''}`;

    const raw    = await callGroq(system, prompt);
    const review = safeParseJSON(raw);
    res.json({ review });
  } catch (err) {
    console.error('Review error:', err.message);
    res.status(500).json({ error: err.message || 'Review failed. Please try again.' });
  }
});

// ── 404 FOR API ROUTES ───────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/user')) {
    return res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  }
  next();
});

// ── GLOBAL ERROR HANDLER ─────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
});

// ── GRACEFUL SHUTDOWN ────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await mongoose.connection.close();
  console.log('✅ MongoDB disconnected');
  process.exit(0);
});

// ── START ─────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 NeuralCode server running on http://localhost:${PORT}`);
  console.log(`🤖 AI engine: Groq (${GROQ_MODEL})`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});
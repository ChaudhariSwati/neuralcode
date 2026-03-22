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

// ── CHAT HISTORY SCHEMA ──────────────────────────
const ChatSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  mode:      { type: String, default: 'explain' },
  messages:  [{
    role:    { type: String, enum: ['user', 'ai'], required: true },
    content: { type: String, required: true },
    time:    { type: Date, default: Date.now }
  }],
  title:     { type: String, default: 'New Chat' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Chat = mongoose.model('Chat', ChatSchema);

// ── QUIZ HISTORY SCHEMA ───────────────────────────
const QuizSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  topic:     { type: String, required: true },
  score:     { type: Number, required: true },
  total:     { type: Number, required: true },
  timeTaken: { type: Number, default: 0 },
  questions: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});
const Quiz = mongoose.model('Quiz', QuizSchema);


// ── HISTORY SCHEMA ────────────────────────────────
// Stores chat messages, quiz attempts, code reviews
const HistorySchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:      { type: String, enum: ['chat', 'quiz', 'review'], required: true },
  title:     { type: String, required: true, maxlength: 200 },
  // Chat: stores message pairs
  messages:  [{
    role:    { type: String, enum: ['user', 'ai'] },
    content: { type: String, maxlength: 10000 },
    mode:    { type: String }
  }],
  // Quiz: stores topic, score, questions
  quiz: {
    topic:     String,
    score:     Number,
    total:     Number,
    timeTaken: Number,
    questions: { type: mongoose.Schema.Types.Mixed }
  },
  // Review: stores code and result
  review: {
    code:     { type: String, maxlength: 10000 },
    lang:     String,
    result:   { type: mongoose.Schema.Types.Mixed }
  },
  createdAt: { type: Date, default: Date.now }
});
const History = mongoose.model('History', HistorySchema);

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

    // Auto-save to history (non-blocking — don't fail if save fails)
    const { saveToHistory, mode, historyId } = req.body;
    if (saveToHistory && historyId) {
      // Append to existing chat session
      History.findOneAndUpdate(
        { _id: historyId, userId: req.user.id },
        { $push: { messages: { role: 'user', content: userMessage.trim(), mode },
                   messages: { role: 'ai',   content: reply, mode } } }
      ).catch(e => console.warn('History append failed:', e.message));
    } else if (saveToHistory) {
      // Create new chat session
      History.create({
        userId: req.user.id,
        type: 'chat',
        title: userMessage.trim().substring(0, 60) + (userMessage.length > 60 ? '...' : ''),
        messages: [
          { role: 'user', content: userMessage.trim(), mode },
          { role: 'ai',   content: reply, mode }
        ]
      }).then(item => {
        // Send historyId back so frontend can append to same session
      }).catch(e => console.warn('History save failed:', e.message));
    }

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
    // Note: quiz results saved via POST /history from frontend after completion
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

// ══════════════════════════════════════════════════
// HISTORY ROUTES
// ══════════════════════════════════════════════════

// GET /history — get all history for current user
app.get('/history', authRequired, async (req, res) => {
  try {
    const { type, limit = 20, page = 1 } = req.query;
    const query = { userId: req.user.id };
    if (type && ['chat', 'quiz', 'review'].includes(type)) query.type = type;

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await History.countDocuments(query);
    const items = await History.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-__v');

    res.json({ items, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('History fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// POST /history — save a history item
app.post('/history', authRequired, async (req, res) => {
  try {
    const { type, title, messages, quiz, review } = req.body;

    if (!type || !title)
      return res.status(400).json({ error: 'type and title are required' });

    const item = await History.create({
      userId: req.user.id,
      type, title, messages, quiz, review
    });

    res.status(201).json({ id: item._id, message: 'Saved to history' });
  } catch (err) {
    console.error('History save error:', err.message);
    res.status(500).json({ error: 'Failed to save history' });
  }
});

// DELETE /history/:id — delete one history item
app.delete('/history/:id', authRequired, async (req, res) => {
  try {
    const item = await History.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id  // ensure user owns this item
    });
    if (!item) return res.status(404).json({ error: 'History item not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('History delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete history item' });
  }
});

// DELETE /history — clear all history for user
app.delete('/history', authRequired, async (req, res) => {
  try {
    const { type } = req.query;
    const query = { userId: req.user.id };
    if (type && ['chat', 'quiz', 'review'].includes(type)) query.type = type;
    await History.deleteMany(query);
    res.json({ message: 'History cleared' });
  } catch (err) {
    console.error('History clear error:', err.message);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});


// ══════════════════════════════════════════════════
// CHAT HISTORY ROUTES
// ══════════════════════════════════════════════════

// Save a new chat message (called after every AI response)
app.post('/api/history/chat', authRequired, async (req, res) => {
  try {
    const { chatId, userMessage, aiReply, mode, title } = req.body;
    if (!userMessage || !aiReply) return res.status(400).json({ error: 'Missing message data' });

    let chat;
    if (chatId) {
      // Append to existing chat session
      chat = await Chat.findOneAndUpdate(
        { _id: chatId, userId: req.user.id },
        {
          $push: {
            messages: [
              { role: 'user', content: userMessage },
              { role: 'ai',   content: aiReply }
            ]
          },
          $set: { updatedAt: new Date() }
        },
        { new: true }
      );
    } else {
      // Create new chat session
      const autoTitle = userMessage.length > 40
        ? userMessage.substring(0, 40) + '...'
        : userMessage;
      chat = await Chat.create({
        userId: req.user.id,
        mode: mode || 'explain',
        title: title || autoTitle,
        messages: [
          { role: 'user', content: userMessage },
          { role: 'ai',   content: aiReply }
        ]
      });
    }
    res.json({ chatId: chat._id });
  } catch (err) {
    console.error('Save chat error:', err.message);
    res.status(500).json({ error: 'Failed to save chat history' });
  }
});

// Get all chat sessions for current user
app.get('/api/history/chats', authRequired, async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.user.id })
      .select('title mode createdAt updatedAt messages')
      .sort({ updatedAt: -1 })
      .limit(50);
    // Return summary (first message preview, count)
    const summary = chats.map(c => ({
      _id: c._id,
      title: c.title,
      mode: c.mode,
      messageCount: c.messages.length,
      preview: c.messages.length > 0 ? c.messages[0].content.substring(0, 80) : '',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));
    res.json({ chats: summary });
  } catch (err) {
    console.error('Get chats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Get full messages for a specific chat
app.get('/api/history/chat/:id', authRequired, async (req, res) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId: req.user.id });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json({ chat });
  } catch (err) {
    console.error('Get chat error:', err.message);
    res.status(500).json({ error: 'Failed to fetch chat' });
  }
});

// Delete a chat session
app.delete('/api/history/chat/:id', authRequired, async (req, res) => {
  try {
    await Chat.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// ══════════════════════════════════════════════════
// QUIZ HISTORY ROUTES
// ══════════════════════════════════════════════════

// Save quiz result
app.post('/api/history/quiz', authRequired, async (req, res) => {
  try {
    const { topic, score, total, timeTaken, questions } = req.body;
    if (!topic || score === undefined || !total)
      return res.status(400).json({ error: 'Missing quiz result data' });

    const quiz = await Quiz.create({
      userId: req.user.id,
      topic, score, total,
      timeTaken: timeTaken || 0,
      questions: questions || []
    });
    res.json({ quizId: quiz._id });
  } catch (err) {
    console.error('Save quiz error:', err.message);
    res.status(500).json({ error: 'Failed to save quiz history' });
  }
});

// Get all quiz history for current user
app.get('/api/history/quizzes', authRequired, async (req, res) => {
  try {
    const quizzes = await Quiz.find({ userId: req.user.id })
      .select('topic score total timeTaken createdAt')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ quizzes });
  } catch (err) {
    console.error('Get quizzes error:', err.message);
    res.status(500).json({ error: 'Failed to fetch quiz history' });
  }
});

// Get full quiz with questions
app.get('/api/history/quiz/:id', authRequired, async (req, res) => {
  try {
    const quiz = await Quiz.findOne({ _id: req.params.id, userId: req.user.id });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    res.json({ quiz });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch quiz' });
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
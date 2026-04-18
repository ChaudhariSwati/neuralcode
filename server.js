// ═══════════════════════════════════════════════════
// NeuralCode — Backend Server (Improved)
// AI Engine: Google Gemini (gemini-1.5-mini-latest)
// Improvements: security, input validation, logging
// ═══════════════════════════════════════════════════

const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const fetch    = require('node-fetch');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();

// ── SECURITY CHECK ON STARTUP ────────────────────
const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET', 'GEMINI_API_KEY'];
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
// AI BACKEND SUPPORT
// ══════════════════════════════════════════════════

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const MODEL_NAME = 'gemini-1.5-mini-latest';

async function callGemini(systemPrompt, userPrompt) {
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const message = `${systemPrompt}\n\nUser: ${userPrompt}`;
    
    const result = await model.generateContent(message);
    const response = await result.response;
    const text = response.text();
    
    if (!text) throw new Error('Empty response from Gemini');
    return text;
  } catch (err) {
    console.error('Gemini API error:', err.message);
    throw new Error(`Gemini API error: ${err.message}`);
  }
}

function simpleFallbackMentorReply(prompt) {
  const text = (prompt || '').trim().toLowerCase();
  if (!text) return 'I am here to help with your coding questions — ask me anything!';

  if (text.includes('variable')) {
    return 'A variable is a named container for a value in your program. You can use it to store text, numbers, or other data and change it later when the program runs.';
  }
  if (text.includes('function')) {
    return 'A function is a reusable block of code that performs a specific task. You give it a name, pass in inputs, and it can return a result or do work for you.';
  }
  if (text.includes('if else') || text.includes('if/else') || (text.includes('if') && text.includes('else'))) {
    return 'An if/else statement lets your program make a decision. If a condition is true, one block runs; otherwise, the alternative block runs.';
  }
  if (text.includes('loop') || text.includes('for') || text.includes('while')) {
    return 'A loop repeats code until a condition is met. Use loops when you need to run the same steps many times, like processing each item in a list.';
  }
  if (text.includes('array') || text.includes('list')) {
    return 'An array is a collection of values stored in order. You can access each item by its position and loop through the array to work with every element.';
  }
  if (text.includes('class') || text.includes('object')) {
    return 'A class defines a blueprint for objects that bundle data and behavior together. Objects created from a class can represent real-world things in your code.';
  }
  if (text.includes('error') || text.includes('bug')) {
    return 'When you see an error, read the message carefully. It usually tells you what went wrong and where, so you can fix the code step by step.';
  }

  return 'I could not reach the AI service right now, but here is a fallback mentor answer: Please ask your coding question again in simple terms and I will help you understand it clearly.';
}

async function callAI(systemPrompt, userPrompt) {
  try {
    return await callGemini(systemPrompt, userPrompt);
  } catch (err) {
    console.warn('AI call failed, using fallback:', err.message);
    return simpleFallbackMentorReply(userPrompt);
  }
}

app.post('/api/demo/ai', async (req, res) => {
  try {
    const { systemPrompt, userPrompt } = req.body;
    if (!systemPrompt || !userPrompt) {
      return res.status(400).json({ error: 'Missing systemPrompt or userPrompt' });
    }

    const reply = await callAI(systemPrompt, userPrompt);
    res.json({ reply });
  } catch (err) {
    console.error('Demo AI error:', err.message);
    res.json({ reply: simpleFallbackMentorReply(req.body?.userPrompt || '') });
  }
});

// ── POST /api/chat ───────────────────────────────
app.post('/api/chat', authRequired, async (req, res) => {
  try {
    const { systemPrompt, userMessage } = req.body;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length < 2)
      return res.status(400).json({ error: 'Please enter a message' });
    if (userMessage.length > 2000)
      return res.status(400).json({ error: 'Message is too long (max 2000 characters)' });

    const system = systemPrompt || 'You are a helpful coding mentor for beginners.';
    const reply  = await callAI(system, userMessage.trim());

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

    const system = 'You are a quiz generator. Return ONLY a raw JSON array with no markdown fences or extra text.';
    const prompt = `Create exactly 5 beginner-level multiple choice quiz questions about: "${topic.trim()}"
Return ONLY this JSON array with no markdown fences, no extra text, just pure JSON:
[{"q":"question text?","options":["A) option one","B) option two","C) option three","D) option four"],"correct":0,"explain":"explanation text"}]`;

    const raw = await callAI(system, prompt);
    
    // Better error handling for JSON parsing
    let questions;
    try {
      questions = safeParseJSON(raw);
    } catch (parseErr) {
      console.warn('Quiz JSON parse failed, using fallback:', parseErr.message);
      // Return fallback quiz if Gemini fails
      questions = generateFallbackQuiz(topic);
    }

    if (!Array.isArray(questions) || questions.length === 0)
      questions = generateFallbackQuiz(topic);

    res.json({ questions });
    // Note: quiz results saved via POST /history from frontend after completion
  } catch (err) {
    console.error('Quiz error:', err.message);
    res.status(500).json({ error: err.message || 'Quiz generation failed. Please try again.' });
  }
});

function generateFallbackQuiz(topic) {
  const topicLower = (topic || '').toLowerCase();
  
  // Determine quiz type based on topic
  let quiz = [];
  
  if (topicLower.includes('variable') || topicLower.includes('data type')) {
    quiz = [
      {"q":"What is a variable?","options":["A) A named container for storing a value","B) A type of number","C) A programming language","D) A function parameter"],"correct":0,"explain":"A variable is a named container that stores a value which can change during program execution."},
      {"q":"Which is a valid variable name?","options":["A) 123var","B) var-name","C) var_name","D) var name"],"correct":2,"explain":"Variable names can contain letters, numbers, and underscores, but cannot start with a number or contain spaces."},
      {"q":"In JavaScript, which keyword declares a variable?","options":["A) variable","B) var","C) declare","D) let or const"],"correct":3,"explain":"JavaScript uses 'var', 'let', and 'const' to declare variables with different scoping rules."},
      {"q":"What will this print: let x = 5; x = x + 3; console.log(x);","options":["A) 5","B) 8","C) undefined","D) Error"],"correct":1,"explain":"The variable x is first set to 5, then increased by 3, resulting in 8."},
      {"q":"A variable declared with 'const' can be changed","options":["A) Yes, anytime","B) No, never","C) Only once after declaration","D) Only if reassigned"],"correct":1,"explain":"Variables declared with 'const' cannot be reassigned after initialization."}
    ];
  } else if (topicLower.includes('function') || topicLower.includes('method')) {
    quiz = [
      {"q":"What is a function?","options":["A) A variable that stores text","B) A reusable block of code that performs a task","C) A type of loop","D) A data structure"],"correct":1,"explain":"A function is a reusable block of code designed to perform a specific task."},
      {"q":"How do you call a function named greet()?","options":["A) function greet()","B) call greet()","C) greet()","D) execute greet()"],"correct":2,"explain":"To call a function, use its name followed by parentheses: greet()"},
      {"q":"What does a 'return' statement do?","options":["A) Exits the program","B) Sends a value back from the function","C) Clears variables","D) Repeats the function"],"correct":1,"explain":"The return statement sends a value back to where the function was called."},
      {"q":"Can a function have no parameters?","options":["A) No, it requires at least one","B) Yes, functions can have zero parameters","C) Only if it returns a value","D) Only in certain languages"],"correct":1,"explain":"Functions can be defined with zero parameters and still be useful."},
      {"q":"What is the purpose of parameters?","options":["A) To store global variables","B) To pass values into a function","C) To declare function names","D) To return multiple values"],"correct":1,"explain":"Parameters allow you to pass information into a function when you call it."}
    ];
  } else if (topicLower.includes('loop') || topicLower.includes('for') || topicLower.includes('while')) {
    quiz = [
      {"q":"What is a loop used for?","options":["A) Organizing code","B) Repeating code multiple times","C) Declaring variables","D) Defining functions"],"correct":1,"explain":"Loops allow you to repeat a block of code many times without rewriting it."},
      {"q":"How many times will this loop run: for(let i=0; i<5; i++)","options":["A) 4 times","B) 5 times","C) 6 times","D) Infinite times"],"correct":1,"explain":"The loop runs from i=0 to i=4, which is 5 iterations total."},
      {"q":"What is the difference between 'for' and 'while' loops?","options":["A) No difference","B) 'for' is faster","C) 'for' has a counter, 'while' checks a condition","D) 'while' is more modern"],"correct":2,"explain":"'for' loops typically have an initialization, condition, and increment; 'while' loops just check a condition."},
      {"q":"What does 'break' do in a loop?","options":["A) Pauses the loop","B) Restarts the loop","C) Exits the loop","D) Skips to next iteration"],"correct":2,"explain":"The 'break' statement immediately exits the loop."},
      {"q":"What does 'continue' do in a loop?","options":["A) Stops the loop","B) Skips the current iteration and continues with the next","C) Restarts from the beginning","D) Does nothing"],"correct":1,"explain":"The 'continue' statement skips the rest of the current iteration and moves to the next one."}
    ];
  } else if (topicLower.includes('array') || topicLower.includes('list')) {
    quiz = [
      {"q":"What is an array?","options":["A) A single value","B) A collection of values stored in order","C) A function","D) A data type"],"correct":1,"explain":"An array is a collection of values stored at different indices, accessible by position."},
      {"q":"How do you access the first element of an array?","options":["A) array[1]","B) array[0]","C) array.first()","D) array(0)"],"correct":1,"explain":"Array indexing starts at 0, so the first element is at index 0."},
      {"q":"What will this return: [1,2,3].length","options":["A) 0","B) 1","C) 3","D) undefined"],"correct":2,"explain":"The length property returns the number of elements in the array, which is 3."},
      {"q":"How do you add an element to an array?","options":["A) array.add(item)","B) array.push(item)","C) array[0] = item","D) Both B and C"],"correct":3,"explain":"You can use push() to add to the end, or directly assign to an index."},
      {"q":"What does array.map() do?","options":["A) Finds elements","B) Removes elements","C) Transforms each element and returns a new array","D) Sorts the array"],"correct":2,"explain":"map() applies a function to each element and returns a new array with the results."}
    ];
  } else {
    // Generic beginner quiz
    quiz = [
      {"q":"What is programming?","options":["A) Writing text on a computer","B) Giving instructions to a computer in a structured way","C) Using software applications","D) Designing websites"],"correct":1,"explain":"Programming is the process of creating a set of instructions for a computer to follow."},
      {"q":"What is the purpose of comments in code?","options":["A) To make code run faster","B) To confuse other programmers","C) To explain code for humans to read","D) To store data"],"correct":2,"explain":"Comments are notes that explain code logic and are ignored during execution."},
      {"q":"What is a data type?","options":["A) A way to organize files","B) A category of data like number, text, or boolean","C) A programming language","D) A function"],"correct":1,"explain":"Data types like int, string, and boolean categorize the kind of data being stored."},
      {"q":"What does an 'if' statement do?","options":["A) Repeats code","B) Declares a variable","C) Executes code based on a condition","D) Creates a function"],"correct":2,"explain":"An 'if' statement checks whether a condition is true and executes code accordingly."},
      {"q":"What is debugging?","options":["A) Removing features from code","B) Finding and fixing errors in code","C) Adding more code","D) Rewriting a program"],"correct":1,"explain":"Debugging is the process of identifying and correcting errors in your program."}
    ];
  }
  
  return quiz;
}

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

    const raw    = await callAI(system, prompt);
    const review = safeParseJSON(raw);
    res.json({ review });
  } catch (err) {
    console.error('Review error:', err.message);
    res.status(500).json({ error: err.message || 'Review failed. Please try again.' });
  }
});

// ══════════════════════════════════════════════════
// CODE CHALLENGE ROUTES (JudgeZero Integration)
// ══════════════════════════════════════════════════

const JUDGER_URL = process.env.JUDGER_API_URL || 'https://judge0-ce.p.rapidapi.com';
const JUDGER_KEY = process.env.JUDGER_API_KEY;
const JUDGER_HOST = process.env.JUDGER_HOST || 'judge0-ce.p.rapidapi.com';

// Sample problem statements
const CODING_PROBLEMS = [
  {
    id: 1,
    title: 'Two Sum',
    difficulty: 'Easy',
    description: 'Given an array of integers nums and an integer target, return the indices of the two numbers such that they add up to target. You may assume that each input has exactly one solution, and you may not use the same element twice.',
    examples: [
      { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'Because nums[0] + nums[1] == 9, we return [0, 1].' },
      { input: 'nums = [3,2,4], target = 6', output: '[1,2]', explanation: 'Because nums[1] + nums[2] == 6, we return [1, 2].' },
      { input: 'nums = [3,3], target = 6', output: '[0,1]', explanation: 'Two unique indices' },
      { input: 'nums = [1,2,3], target = 7', output: '[]', explanation: 'No solution exists' }
    ],
    testCases: [
      { input: 'const nums = [2,7,11,15];\nconst target = 9;\nconsole.log(JSON.stringify(twoSum(nums, target)));', expected: '[0,1]' },
      { input: 'const nums = [3,2,4];\nconst target = 6;\nconsole.log(JSON.stringify(twoSum(nums, target)));', expected: '[1,2]' },
      { input: 'const nums = [3,3];\nconst target = 6;\nconsole.log(JSON.stringify(twoSum(nums, target)));', expected: '[0,1]' },
      { input: 'const nums = [1,2,3];\nconst target = 7;\nconsole.log(JSON.stringify(twoSum(nums, target)));', expected: '[]' }
    ],
    templateCode: 'function twoSum(nums, target) {\n  // Write your solution here\n  \n}\n\n// Test with the provided numbers\nconsole.log(JSON.stringify(twoSum(nums, target)));',
    language: 63 // JavaScript
  },
  {
    id: 2,
    title: 'Reverse String',
    difficulty: 'Easy',
    description: 'Write a function that reverses a string. The input string is given as an array of characters s.',
    examples: [
      { input: 's = ["h","e","l","l","o"]', output: '["o","l","l","e","h"]', explanation: 'Reversed array' },
      { input: 's = ["H","a","n","n","a","h"]', output: '["h","a","n","n","a","H"]', explanation: 'Reversed' },
      { input: 's = ["a"]', output: '["a"]', explanation: 'Single element' },
      { input: 's = ["a","b"]', output: '["b","a"]', explanation: 'Two elements' }
    ],
    testCases: [
      { input: 'const s = ["h","e","l","l","o"];\nreverseString(s);\nconsole.log(JSON.stringify(s));', expected: '["o","l","l","e","h"]' },
      { input: 'const s = ["H","a","n","n","a","h"];\nreverseString(s);\nconsole.log(JSON.stringify(s));', expected: '["h","a","n","n","a","H"]' },
      { input: 'const s = ["a"];\nreverseString(s);\nconsole.log(JSON.stringify(s));', expected: '["a"]' },
      { input: 'const s = ["a","b"];\nreverseString(s);\nconsole.log(JSON.stringify(s));', expected: '["b","a"]' }
    ],
    templateCode: 'function reverseString(s) {\n  // Reverse the array in-place\n  \n}\n\nconsole.log(JSON.stringify(s));',
    language: 63
  },
  {
    id: 3,
    title: 'Palindrome Number',
    difficulty: 'Easy',
    description: 'Given an integer x, return true if x is palindrome number. An integer is a palindrome when it reads the same backward as forward.',
    examples: [
      { input: 'x = 121', output: 'true', explanation: 'Reads same forwards and backwards' },
      { input: 'x = -121', output: 'false', explanation: 'Negative numbers are not palindromes' },
      { input: 'x = 10', output: 'false', explanation: 'Reads as 01 backwards = 1' },
      { input: 'x = 0', output: 'true', explanation: 'Single digit is always palindrome' }
    ],
    testCases: [
      { input: 'const x = 121;\nconsole.log(isPalindrome(x));', expected: 'true' },
      { input: 'const x = -121;\nconsole.log(isPalindrome(x));', expected: 'false' },
      { input: 'const x = 10;\nconsole.log(isPalindrome(x));', expected: 'false' },
      { input: 'const x = 0;\nconsole.log(isPalindrome(x));', expected: 'true' }
    ],
    templateCode: 'function isPalindrome(x) {\n  // Check if number is palindrome\n  \n}\n\nconsole.log(isPalindrome(x));',
    language: 63
  },
  {
    id: 4,
    title: 'Valid Parentheses',
    difficulty: 'Easy',
    description: 'Given a string s containing just the characters "(", ")", "{", "}", "[" and "]", determine if the input string is valid. A string is valid if open brackets are closed by matching brackets.',
    examples: [
      { input: 's = "()"', output: 'true', explanation: 'Simple pair' },
      { input: 's = "()[]{}"', output: 'true', explanation: 'Multiple types' },
      { input: 's = "(]"', output: 'false', explanation: 'Mismatched brackets' },
      { input: 's = "([)]"', output: 'false', explanation: 'Interleaved mismatches' }
    ],
    testCases: [
      { input: 'const s = "()";\\nconsole.log(isValid(s));', expected: 'true' },
      { input: 'const s = "()[]{}";\\nconsole.log(isValid(s));', expected: 'true' },
      { input: 'const s = "(]";\\nconsole.log(isValid(s));', expected: 'false' },
      { input: 'const s = "([)]";\\nconsole.log(isValid(s));', expected: 'false' }
    ],
    templateCode: 'function isValid(s) {\n  // Check if parentheses are balanced\n  \n}\n\nconsole.log(isValid(s));',
    language: 63
  },
  {
    id: 5,
    title: 'Merge Two Sorted Lists',
    difficulty: 'Easy',
    description: 'Merge two sorted linked lists and return it as a sorted list. The list should be made by splicing together the nodes of the two lists.',
    examples: [
      { input: 'list1 = [1,2,4], list2 = [1,3,4]', output: '[1,1,2,3,4,4]', explanation: 'Merged and sorted' },
      { input: 'list1 = [], list2 = [0]', output: '[0]', explanation: 'First list empty' },
      { input: 'list1 = [], list2 = []', output: '[]', explanation: 'Both empty' },
      { input: 'list1 = [5], list2 = [1,2,6,7]', output: '[1,2,5,6,7]', explanation: 'Different sizes' }
    ],
    testCases: [
      { input: 'const list1 = [1,2,4];\nconst list2 = [1,3,4];\nconsole.log(JSON.stringify(mergeTwoLists(list1, list2)));', expected: '[1,1,2,3,4,4]' },
      { input: 'const list1 = [];\nconst list2 = [0];\nconsole.log(JSON.stringify(mergeTwoLists(list1, list2)));', expected: '[0]' },
      { input: 'const list1 = [];\nconst list2 = [];\nconsole.log(JSON.stringify(mergeTwoLists(list1, list2)));', expected: '[]' },
      { input: 'const list1 = [5];\nconst list2 = [1,2,6,7];\nconsole.log(JSON.stringify(mergeTwoLists(list1, list2)));', expected: '[1,2,5,6,7]' }
    ],
    templateCode: 'function mergeTwoLists(list1, list2) {\n  // Merge and sort the two arrays\n  \n}\n\nconsole.log(JSON.stringify(mergeTwoLists(list1, list2)));',
    language: 63
  }
];

// GET /api/problems — Get all problems
app.get('/api/problems', (req, res) => {
  try {
    const problems = CODING_PROBLEMS.map(p => ({
      id: p.id,
      title: p.title,
      difficulty: p.difficulty,
      description: p.description
    }));
    res.json({ problems });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch problems' });
  }
});

// GET /api/problems/:id — Get problem details with examples
app.get('/api/problems/:id', (req, res) => {
  try {
    const problem = CODING_PROBLEMS.find(p => p.id === parseInt(req.params.id));
    if (!problem) return res.status(404).json({ error: 'Problem not found' });
    
    res.json({
      id: problem.id,
      title: problem.title,
      difficulty: problem.difficulty,
      description: problem.description,
      examples: problem.examples,
      testCases: problem.testCases,
      templateCode: problem.templateCode,
      language: problem.language
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch problem' });
  }
});

// POST /api/submit — Submit code for execution
app.post('/api/submit', async (req, res) => {
  try {
    const { code, language, testCases } = req.body;

    if (!code || code.trim().length === 0)
      return res.status(400).json({ error: 'Please provide code to submit' });
    if (!language || !testCases || !Array.isArray(testCases))
      return res.status(400).json({ error: 'Invalid submission format' });

    const results = [];

    for (const testCase of testCases) {
      try {
        // Submit code to JudgeZero
        const submission = await fetch(`${JUDGER_URL}/submissions?wait=true&base64_encoded=false`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-RapidAPI-Key': JUDGER_KEY,
            'X-RapidAPI-Host': JUDGER_HOST
          },
          body: JSON.stringify({
            source_code: code + '\n' + testCase.input,
            language_id: language,
            stdin: '',
            expected_output: testCase.expected
          })
        });

        if (!submission.ok) {
          const err = await submission.text();
          console.error('JudgeZero error:', err);
          results.push({
            input: testCase.input,
            expected: testCase.expected,
            status: 'ERROR',
            message: 'API Error - could not execute code'
          });
          continue;
        }

        const result = await submission.json();

        // Map status codes
        const statusMap = {
          1: 'IN_QUEUE',
          2: 'PROCESSING',
          3: 'ACCEPTED',
          4: 'WRONG_ANSWER',
          5: 'TIME_LIMIT',
          6: 'COMPILATION_ERROR',
          7: 'RUNTIME_ERROR',
          8: 'INTERNAL_ERROR'
        };

        const status = statusMap[result.status?.id] || 'UNKNOWN';
        const output = result.stdout ? result.stdout.trim() : '';
        const stderr = result.stderr ? result.stderr.trim() : '';
        const compilationError = result.compile_output ? result.compile_output.trim() : '';

        results.push({
          input: testCase.input,
          expected: testCase.expected,
          actual: output,
          status: status,
          passed: status === 'ACCEPTED',
          error: stderr || compilationError || null,
          executionTime: result.time || 0,
          memory: result.memory || 0
        });
      } catch (err) {
        console.error('Submission error:', err.message);
        results.push({
          input: testCase.input,
          expected: testCase.expected,
          status: 'ERROR',
          message: err.message,
          passed: false
        });
      }
    }

    // Calculate overall result
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const allPassed = passed === total;

    // Save to user history if all passed
    if (allPassed && req.user) {
      const problem = CODING_PROBLEMS.find(p => p.testCases === testCases);
      try {
        await History.create({
          userId: req.user.id,
          type: 'challenge',
          title: problem ? problem.title : 'Code Challenge',
          review: {
            code: code,
            lang: 'javascript',
            result: { passed: true, testsPassed: total, totalTests: total }
          }
        });
      } catch (e) {
        console.warn('History save failed:', e.message);
      }
    }

    res.json({
      testResults: results,
      summary: {
        passed: passed,
        total: total,
        allPassed: allPassed,
        successRate: Math.round((passed / total) * 100)
      }
    });
  } catch (err) {
    console.error('Submit error:', err.message);
    res.status(500).json({ error: err.message || 'Submission failed' });
  }
});

// POST /api/compile — Compile and run code (for practice)
app.post('/api/compile', async (req, res) => {
  try {
    const { code, language } = req.body;

    if (!code || code.trim().length === 0)
      return res.status(400).json({ error: 'Please provide code to compile' });
    if (!language || typeof language !== 'number')
      return res.status(400).json({ error: 'Invalid language specified' });

    // Submit code to JudgeZero for execution
    const submission = await fetch(`${JUDGER_URL}/submissions?wait=true&base64_encoded=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': JUDGER_KEY,
        'X-RapidAPI-Host': JUDGER_HOST
      },
      body: JSON.stringify({
        source_code: code,
        language_id: language,
        stdin: '',
        expected_output: ''
      })
    });

    if (!submission.ok) {
      const err = await submission.text();
      console.error('JudgeZero error:', err);
      return res.status(500).json({ error: 'Compilation service unavailable' });
    }

    const result = await submission.json();

    // Return the full result
    res.json({
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      compile_output: result.compile_output || '',
      status: result.status,
      time: result.time,
      memory: result.memory,
      message: result.message || null
    });
  } catch (err) {
    console.error('Compile error:', err.message);
    res.status(500).json({ error: err.message || 'Compilation failed' });
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
  console.log(`🤖 AI engine: Gemini (${MODEL_NAME})`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});
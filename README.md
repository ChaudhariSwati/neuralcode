<div align="center">

<img src="https://img.shields.io/badge/NeuralCode-AI%20Coding%20Mentor-6c47ff?style=for-the-badge&logo=brain&logoColor=white" alt="NeuralCode"/>

# 🧠 CodeVerse — AI-Powered Coding Mentor

### *Your personal AI tutor that explains code like a patient teacher, not a textbook*

[![Live Demo](https://img.shields.io/badge/🚀%20Live%20Demo-neuralcode.onrender.com-00c9a7?style=for-the-badge)](https://neuralcode.onrender.com)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://mongodb.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

> 🎓 **Final Year Project** | B.Tech Computer Science & Engineering

</div>

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Live Demo](#-live-demo)
- [Features](#-features)
- [Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [How It Works](#-how-it-works)
- [API Reference](#-api-reference)
- [Database Schema](#-database-schema)
- [Security](#-security)
- [Local Setup](#-local-setup)
- [Deployment](#-deployment)
- [Test Results](#-test-results)
- [Screenshots](#-screenshots)
- [Future Enhancements](#-future-enhancements)

---

## 🌟 Overview

**CodeVerse** is a full-stack AI-powered coding mentor built for absolute beginners. Instead of just answering questions, it teaches — using real-life analogies, code examples, interactive quizzes, and personalized code reviews.

```
A student types: "What is a variable?"
CodeVerse explains it like a labeled box 📦
Shows a code example 💻
Gives a "Try it yourself" challenge 🎯
Tracks their XP and progress 📊
```

Built as a Final Year Project demonstrating full-stack development, AI integration, database design, security implementation, and cloud deployment.

---

## 🚀 Live Demo

> 🔗 **[https://neuralcode.onrender.com](https://neuralcode.onrender.com)**

| Credential | Value |
|---|---|
| Demo mode | Click "Continue as Guest" — no login needed |
| Register | Create a free account to save progress |

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🤖 AI Mentor Chat
4 intelligent chat modes:
- **🧠 Explain Mode** — Plain English with analogies
- **🐛 Debug Mode** — Find and fix bugs step-by-step
- **🎯 Challenge Mode** — Practice tasks with hints
- **👶 ELI5 Mode** — Explain like you're 5 years old

</td>
<td width="50%">

### 🎯 AI Quiz Generator
- 6 topic categories (JS, Python, HTML, OOP...)
- 5 fresh AI-generated questions every session
- Never the same quiz twice
- Instant explanations on wrong answers
- XP rewards for completion

</td>
</tr>
<tr>
<td width="50%">

### 🔍 AI Code Reviewer
- Score 0–100 with letter grade
- 3 metrics: Readability, Correctness, Best Practices
- Colour-coded feedback (✓ good / ⚠ warn / ✕ bad)
- Optional: Show improved version of code
- Beginner-friendly explanations

</td>
<td width="50%">

### 📚 History & Progress
- Full chat history saved to MongoDB
- All quiz results with scores and times
- XP system with 6 levels (Beginner → Pro Coder)
- Achievements and streak counter
- Learning roadmap with progress tracking

</td>
</tr>
</table>

---

## 🏗 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT BROWSER                       │
│              (Single Page App - index.html)              │
│                                                          │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│   │  Auth UI │ │Chat Page │ │Quiz Page │ │ History  │  │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│        └────────────┴────────────┴────────────┘         │
│                          │ HTTPS                         │
└──────────────────────────┼──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  EXPRESS.JS BACKEND                      │
│              (Node.js — Render.com)                      │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Auth Routes │  │  AI Routes  │  │ History Routes  │  │
│  │ /auth/login │  │  /api/chat  │  │/api/history/... │  │
│  │ /auth/reg.. │  │  /api/quiz  │  │                 │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
│         │                │                  │            │
└─────────┼────────────────┼──────────────────┼───────────┘
          │                │                  │
          ▼                ▼                  ▼
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  MongoDB Atlas  │  │ Google Gemini    │  │  MongoDB Atlas   │
│  (User Accounts │  │ API              │  │  (Chat History   │
│   XP, Progress) │  │ (gemini-1.5-mini)│  │   Quiz Results)  │
└─────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## 🔄 How It Works

### User Authentication Flow

```
User submits form
       │
       ▼
  Input validation
  (email regex, pw length)
       │
       ▼
  bcrypt.hash(password, 12)
       │
       ▼
  Save to MongoDB
       │
       ▼
  jwt.sign({ id, email }) ──► Returns JWT token
       │
       ▼
  Frontend stores token
  in localStorage
       │
       ▼
  Every API request sends:
  Authorization: Bearer <token>
```

### AI Chat Flow

```
User sends message
       │
       ▼
  authRequired middleware
  verifies JWT token
       │
       ├── Invalid → 401 Unauthorized
       │
       ▼ Valid
  POST to Google Gemini API
  (gemini-1.5-mini-latest)
  with system prompt + message
       │
       ▼
  AI response received
       │
       ├──► Send reply to frontend
       │
       └──► Save to MongoDB
            (chat history)
```

### Quiz Generation Flow

```
User picks topic
       │
       ▼
  Backend sends prompt to Gemini API:
  "Generate 5 MCQ questions about [topic]
   Return ONLY JSON array"
       │
       ▼
  safeParseJSON() extracts
  clean JSON from response
       │
       ▼
  5 questions rendered
  with A/B/C/D options
       │
       ▼
  User answers → score calculated
  → XP awarded → result saved
  to MongoDB quiz history
```

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | HTML5 + CSS3 + Vanilla JS | Single page app, no framework |
| **Backend** | Node.js + Express.js | REST API server |
| **Database** | MongoDB Atlas + Mongoose | User data, chat/quiz history |
| **AI Engine** | Google Gemini API (gemini-1.5-mini-latest) | Chat, quiz generation, code review |
| **Auth** | JWT + bcryptjs | Secure authentication |
| **Hosting** | Render.com | Free Node.js hosting |
| **Version Control** | GitHub | Source code management |

### Why these choices?

| Decision | Reason |
|---|---|
| Vanilla JS (no React) | Simpler for FYP, shows core JS understanding |
| Gemini for AI tasks | Free tier with generous limits, multimodal capabilities, reliable API |
| MongoDB over SQL | Flexible schema for evolving user data, free Atlas tier |
| Render over Vercel | Vercel doesn't support Express `app.listen()`, Render does |
| bcrypt cost 12 | Balance between security and performance |

---

## 📊 API Reference

### Authentication Routes

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | ❌ | Register new user |
| `POST` | `/auth/login` | ❌ | Login, returns JWT |
| `GET` | `/auth/me` | ✅ JWT | Get current user |

### AI Routes (all require JWT)

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/api/chat` | `{systemPrompt, userMessage}` | AI mentor response |
| `POST` | `/api/quiz` | `{topic}` | Generate 5 quiz questions |
| `POST` | `/api/review` | `{code, lang, beginner, rewrite}` | Code review |

### Progress Routes

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `PATCH` | `/user/progress` | ✅ JWT | Save XP, stats, progress |

### History Routes (all require JWT)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/history/chat` | Save chat message pair |
| `GET` | `/api/history/chats` | List all chat sessions |
| `GET` | `/api/history/chat/:id` | Get full conversation |
| `DELETE` | `/api/history/chat/:id` | Delete chat |
| `POST` | `/api/history/quiz` | Save quiz result |
| `GET` | `/api/history/quizzes` | List all quiz attempts |

### Example Response — `/api/quiz`

```json
{
  "questions": [
    {
      "q": "What is a variable in JavaScript?",
      "options": [
        "A) A fixed value that never changes",
        "B) A named container that stores a value",
        "C) A type of function",
        "D) A loop structure"
      ],
      "correct": 1,
      "explain": "A variable is like a labeled box — you give it a name and store something inside it."
    }
  ]
}
```

---

## 🗄 Database Schema

### Users Collection

```javascript
{
  _id: ObjectId,
  name:      String,        // "Swati Chaudhary"
  email:     String,        // unique, lowercase
  password:  String,        // bcrypt hash "$2a$12$..."
  role:      String,        // "student" | "self" | "career" | "other"
  xp:        Number,        // 0–∞ experience points
  streak:    Number,        // days in a row active
  stats:     [Number],      // [questions, quizzes, reviews, 0]
  progress:  [Number],      // [html%, js%, python%, algo%]
  createdAt: Date
}
```

### Chats Collection

```javascript
{
  _id:      ObjectId,
  userId:   ObjectId,       // ref: User
  mode:     String,         // "explain" | "debug" | "challenge" | "eli5"
  title:    String,         // first 40 chars of first message
  messages: [{
    role:    String,        // "user" | "ai"
    content: String,
    time:    Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### Quizzes Collection

```javascript
{
  _id:       ObjectId,
  userId:    ObjectId,      // ref: User
  topic:     String,        // "JavaScript fundamentals..."
  score:     Number,        // correct answers
  total:     Number,        // total questions (5)
  timeTaken: Number,        // seconds
  questions: Array,         // full question data
  createdAt: Date
}
```

---

## 🔐 Security

| Feature | Implementation | Why |
|---|---|---|
| **Password hashing** | `bcrypt.hash(pw, 12)` | Bcrypt is slow by design — resistant to brute force |
| **JWT authentication** | `jwt.sign({id}, SECRET, {expiresIn: '7d'})` | Stateless, no server-side sessions needed |
| **Input validation** | Custom `validateFields()` + regex | Prevents NoSQL injection, XSS |
| **Protected routes** | `authRequired` middleware | Every AI/history route requires valid JWT |
| **API key security** | Server-side only via `process.env` | Key never reaches browser |
| **CORS** | `cors({origin: true})` | Safe — JWT is the actual auth layer |
| **Request limits** | `express.json({limit: '50kb'})` | Prevents payload attacks |
| **Timing attack prevention** | Always calls `bcrypt.compare()` even if user not found | Constant-time response |

### Security Test Results

```
✅ Unauthenticated API request    → 401 "No token provided"
✅ Fake JWT token                 → 401 "Invalid token"
✅ Expired JWT token              → 401 "Session expired"
✅ Wrong password                 → 401 "Invalid email or password"
✅ Duplicate email                → 409 "Account already exists"
✅ NoSQL injection attempt        → 400 "Invalid email format"
✅ Password in database           → "$2a$12$..." (bcrypt hash)
✅ API key in browser             → Not found (server-side only)
```

---

## 🚀 Local Setup

### Prerequisites

- [Node.js v18+](https://nodejs.org)
- [MongoDB Atlas account](https://mongodb.com/cloud/atlas) (free)
- [Groq API key](https://console.groq.com) (free)

### Step 1 — Clone

```bash
git clone https://github.com/ChaudhariSwati/CodeVerse.git
cd CodeVerse
```

### Step 2 — Install dependencies

```bash
npm install
```

### Step 3 — Create `.env` file

```env
GROQ_API_KEY=your_groq_key_here
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/neuralcode?retryWrites=true&w=majority
JWT_SECRET=any_long_random_string_here_min_32_chars
PORT=3001
```

### Step 4 — Run

```bash
node server.js
```

### Step 5 — Open

```
http://localhost:3001
```

You should see:
```
✅ MongoDB connected
🚀 CodeVerse server running on http://localhost:3001
🤖 AI engine: Groq (llama-3.3-70b-versatile)
```

---

## ☁️ Deployment

Deployed on **[Render.com](https://render.com)** (free tier).

```
GitHub Push → Render detects change → npm install → node server.js → Live
```

### Render Configuration

| Setting | Value |
|---|---|
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Environment | Node |
| Auto-Deploy | Yes (on every git push) |

### Environment Variables on Render

```
GROQ_API_KEY   = gsk_...
MONGO_URI      = mongodb+srv://...
JWT_SECRET     = ...
```

> ⚠️ **MongoDB Atlas**: Set Network Access to `0.0.0.0/0` (allow all IPs) so Render's servers can connect.

---

## 🧪 Test Results

### Functional Tests

| # | Test Case | Expected | Result |
|---|---|---|---|
| T01 | Register with valid details | Account created, JWT returned | ✅ Pass |
| T02 | Register with duplicate email | 409 error shown | ✅ Pass |
| T03 | Login with correct credentials | Dashboard opens | ✅ Pass |
| T04 | Login with wrong password | Error message shown | ✅ Pass |
| T05 | Auto-login on page refresh | Dashboard loads without login | ✅ Pass |
| T06 | AI chat responds | Answer displayed | ✅ Pass |
| T07 | Quiz generates 5 questions | Questions appear with options | ✅ Pass |
| T08 | Code review returns score | Score 0-100 with feedback | ✅ Pass |
| T09 | XP saves to MongoDB | XP persists after logout/login | ✅ Pass |
| T10 | Chat history saved | Previous chats appear in History | ✅ Pass |

### Security Tests

| # | Test Case | Expected | Result |
|---|---|---|---|
| S01 | Call `/api/chat` without token | 401 Unauthorized | ✅ Pass |
| S02 | Call `/api/chat` with fake token | 401 Invalid token | ✅ Pass |
| S03 | Password field in MongoDB | bcrypt hash visible | ✅ Pass |
| S04 | NoSQL injection in email field | 400 Invalid format | ✅ Pass |
| S05 | Groq API key in browser console | Not found | ✅ Pass |

---

## 🔮 Future Enhancements

| Feature | Priority | Description |
|---|---|---|
| Streaming AI responses | 🔴 High | Word-by-word like ChatGPT using SSE |
| Code execution | 🔴 High | Run code in browser via Judge0 API |
| PWA / Mobile app | 🟡 Medium | Installable on phone via manifest.json |
| Dark mode | 🟡 Medium | CSS variable toggle |
| Daily streak emails | 🟡 Medium | Nodemailer reminders |
| Leaderboard | 🟢 Low | Top XP earners this week |
| Multi-language | 🟢 Low | Hindi, Marathi UI support |

---

## 📄 Project Documentation

| Document | Description |
|---|---|
| `CodeVerse_SRS.docx` | Software Requirements Specification — functional & non-functional requirements, use cases |
| `CodeVerse_Project_Report.docx` | Full 8-chapter academic report — literature review, design, implementation, testing |
| `CodeVerse_Test_Plan.docx` | 53 test cases with expected and actual results |

---

## 👩‍💻 Author

**Swati Chaudhary**
Final Year B.Tech — Computer Science & Engineering

[![GitHub](https://img.shields.io/badge/GitHub-ChaudhariSwati-181717?style=flat&logo=github)](https://github.com/ChaudhariSwati)

---

## 📝 License

```
MIT License — free to use, modify and distribute
```

---

<div align="center">




⭐ Star this repo if you found it helpful!

</div>
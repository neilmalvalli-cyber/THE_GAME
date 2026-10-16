# 🎯 THE HUNT — Complete Setup & Architecture Guide

> **CSI NMAMIT Digital Treasure Hunt & CTF Platform**  
> An interactive mission-based puzzle hunt featuring sequential level decryption, tactical coin economy, secret fragment combination, and a CTFd-style tie-breaker scoreboard.

---

## 🛠 1. Frameworks & Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Full-Stack Framework** | **Next.js 16** (App Router) | Server-Side Rendering (SSR), Server Components, and Turbopack bundler. |
| **UI Library** | **React 19** | Modern concurrent rendering and interactive client forms. |
| **Language** | **TypeScript 5** | Strict end-to-end type safety across the database and UI layers. |
| **Styling** | **Tailwind CSS v4** | Dark tactical cyber-terminal aesthetic with responsive layout. |
| **Validation** | **Zod 4** | Input parsing and domain validation for auth, challenges, and submissions. |
| **Database & Auth** | **Supabase (PostgreSQL 15)** | Relational database, Row Level Security (RLS), atomic SQL RPCs, and cookie session auth. |
| **Client Connector** | **`@supabase/ssr`** & **`@supabase/supabase-js`** | Secure HTTP-only cookie synchronization between server and browser. |

---

## 📋 2. Prerequisites

Before setting up locally, ensure you have:
1. **Node.js** (v18.18.0 or newer — Node 20 or 22 recommended)
2. **npm** (comes with Node) or **pnpm / yarn**
3. A free **[Supabase](https://supabase.com/)** project account

---

## 🚀 3. Quickstart Installation Guide

### Step 1: Clone and Install Dependencies

```bash
cd tHEHUNT
npm install
```

---

### Step 2: Configure Environment Variables

Create a `.env.local` file at the root of `tHEHUNT` (or copy from `.env.example`):

```bash
cp .env.example .env.local
```

Fill in your Supabase credentials:

```ini
# Supabase Configuration (from Supabase Dashboard -> Project Settings -> API)
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key

# Game Defaults
SUBMISSION_RATE_LIMIT_SECONDS=5
MAX_SUBMISSION_ATTEMPTS_PER_LEVEL=50
NEXT_PUBLIC_APP_NAME="THE HUNT"
NEXT_PUBLIC_APP_DESCRIPTION="CSI NMAMIT Digital Treasure Hunt"
```

> [!IMPORTANT]
> The `SUPABASE_SERVICE_ROLE_KEY` is kept exclusively on the server and is used to verify secret answers and manage admin operations without exposing answers to the browser.

---

### Step 3: Run the Database Schema

1. Open your **[Supabase Dashboard](https://supabase.com/dashboard)**.
2. Select your project and navigate to the **SQL Editor** tab on the left sidebar.
3. Open the file [`supabase/FULL_SCHEMA.sql`](file:///c:/Users/bina1/OneDrive/Desktop/main/main/Projects/CTFd/tHEHUNT/supabase/FULL_SCHEMA.sql) in this repository.
4. Copy its contents, paste them into the Supabase SQL Editor, and click **Run**.

This one script provisions:
- All 14 core tables (`events`, `challenges`, `challenge_levels`, `teams`, `team_members`, `submissions`, `level_solves`, `coin_ledger`, `score_ledger`, `hint_purchases`, etc.)
- Atomic SQL procedures (`award_solve`, `purchase_hint`, `get_score_total`, `get_coin_balance`)
- Row Level Security (RLS) policies protecting answers and participant data

---

### Step 4: Create Default Accounts & Initial Event

You can seed default accounts or create them through the web UI:

#### Option A: Run the Automated Seeding Script
```bash
node scripts/create_users.js
```
This automatically sets up:
- **Admin account:** `admin@hunt.com` / `admin123`
- **Participant account:** `player@hunt.com` / `player123`
- **Active Event:** `THE HUNT 2026` (status: `live`)

#### Option B: Register via Web UI
Participants can self-register directly at `http://localhost:3000/register`:
- **Allowed email formats:** `@gmail.com` or `@nmamit.in` (e.g. `operative@gmail.com` or `usn@nmamit.in`).
- **No email verification needed:** Accounts are automatically pre-confirmed and logged in immediately!

To promote an account to **Admin**:
Go to your Supabase **SQL Editor** and run:
```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE email = 'your-email@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
```

---

### Step 5: Start the Development Server

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser!

---

## 🎮 4. Platform Features & How Everything Works

### 1. Case Files & Sequential Levels
- Each challenge is treated as an investigative "Case File" containing multiple stages (Level 1, Level 2, ...).
- **Sequential Gate:** A participant must solve Level 1 to unlock Level 2.
- Answers are evaluated **server-side only** using `trimmed_case_insensitive` normalization (ignoring capitalization and extra spacing).

### 2. The Final Secret Number Tracker (AI Treasure Hunt Goal)
- On the participant `/dashboard`, there is a dedicated **Final Target Number Decryption Grid**.
- When an admin configures a challenge, they assign a **2-digit secret fragment** (e.g., `47`) and a slot order (e.g. `Slot 1`).
- When a team completes **all levels** of that Case File, their fragment illuminates in green on their dashboard:
  ```
  [ 4 ] [ 7 ]  [ • ] [ • ]  [ • ] [ • ]  [ • ] [ • ]
  ```
- Solving all case files reconstructs the complete master secret telephone number / coordinate code!

### 3. Economy & Intel Hints
- Teams start with a coin allocation (e.g., 100 coins).
- Solving levels earns both **Score Points** (for the leaderboard) and **Coins** (for intelligence purchases).
- If a level has a hint configured, teams can spend coins to reveal the hint text right on the challenge terminal.

### 4. CTFd-Style Live Scoreboard (`/leaderboard`)
- **Podium Display:** Top 3 teams are highlighted with Gold, Silver, and Bronze badges.
- **Tie-Breaker Rule:**
  1. Higher score points always ranks higher.
  2. If two teams have equal points, the team that achieved their last solve **earliest** takes the higher rank.
- **Admin Freeze / Lock Toggle:** The admin can freeze the public scoreboard at any time from `/admin`. When frozen, participants see a "Scoreboard Frozen" banner, while admins still see live updates.

### 5. Admin Spreadsheet Command Center (`/admin`)
- Accessible only to users with the `admin` role.
- **One-Click Builder:** Add a challenge title, description, secret fragment, and multiple levels (prompts, answers, hints, points, and coins) in an interactive spreadsheet view and save them simultaneously.
- **Team Ledger:** Add or deduct bonus points and coins directly from any team in real-time.
- **Scoreboard Lock Toggle:** 1-click toggle to lock or release public scoreboard rankings.

---

## 📁 5. Project Directory Structure

```
tHEHUNT/
├── actions/                   # Next.js Server Actions (Backend logic)
│   ├── auth.ts                # Login, register (auto-confirm), team creation/joining
│   ├── challenges.ts          # Challenge retrieval & spreadsheet builder mutations
│   ├── economy.ts             # Coin balance, hint purchases, admin adjustments
│   ├── events.ts              # Event status retrieval
│   ├── leaderboard.ts         # CTFd tie-breaking scoreboard & freeze check
│   └── submissions.ts         # Answer verification & atomic reward distribution
│
├── app/                       # App Router routes & pages
│   ├── (admin)/admin/         # Admin command center & spreadsheet builder
│   ├── (auth)/login/          # Login page
│   ├── (auth)/register/       # Registration page (@gmail.com / @nmamit.in)
│   ├── (participant)/
│   │   ├── dashboard/         # Participant grid, Final Number tracker, Case Cards
│   │   ├── challenges/[id]/   # Sequential level terminal, hint reveal, answer form
│   │   └── leaderboard/       # CTFd podium scoreboard & freeze notice
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Root redirector
│
├── lib/
│   ├── constants.ts           # Game constants, answer normalizer, code generator
│   ├── supabase/              # Server, client & service-role Supabase clients
│   ├── types/database.ts      # TypeScript interfaces mirroring Postgres schema
│   └── validators/            # Zod validation schemas
│
├── supabase/
│   ├── FULL_SCHEMA.sql        # Master PostgreSQL schema & atomic functions
│   └── SEED_USERS.sql         # Optional SQL script for quick test accounts
│
├── .env.local                 # Local environment variables
└── SETUP_GUIDE.md             # This document
```

---

## 💡 6. For Frontend & Design Teammates

If you are styling or enhancing the visual UI:
- All pages are styled with **Tailwind CSS**.
- The main participant views live under:
  - `app/(participant)/dashboard/page.tsx`
  - `app/(participant)/challenges/[id]/page.tsx`
  - `app/(participant)/leaderboard/page.tsx`
- The backend API contracts and server actions are ready and verified. You can update colors, animations, icons, or add modal dialogues freely without changing the underlying server actions!

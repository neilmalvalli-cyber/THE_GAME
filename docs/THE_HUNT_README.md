# 🎯 THE HUNT — CSI NMAMIT Digital Treasure Hunt

An interactive mission-based puzzle hunt featuring sequential level decryption, tactical coin economy, secret fragment combination, and a CTFd-style tie-breaker scoreboard.

Built with **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript** + **Tailwind CSS v4** + **Supabase (PostgreSQL 15)**.

---

## 📖 Team Documentation & Setup

A complete setup and architecture guide for developers and designers is available here:

👉 **[SETUP_GUIDE.md](./SETUP_GUIDE.md)**

---

## ⚡ Quickstart

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env.local` and add your Supabase credentials.

3. **Deploy database schema:**
   Run [`supabase/FULL_SCHEMA.sql`](./supabase/FULL_SCHEMA.sql) in your Supabase SQL Editor.

4. **Start the local server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

---

## 🔑 Default Accounts (Local Dev)

- **Admin Commander:** `admin@hunt.com` / `admin123` (Access `/admin`)
- **Player Operative:** `player@hunt.com` / `player123` (Access `/dashboard`)
- **Self-registration:** Accepts `@gmail.com` and `@nmamit.in` (Instant access, no email verification link required).

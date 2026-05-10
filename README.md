# DrillPath

Train your young champion. A drill library + progress tracker for youth sports parents.

**Sports:** Basketball, Baseball/Softball, Gymnastics

## Stack

- Next.js (App Router, TypeScript)
- Tailwind CSS
- Supabase (Auth + Postgres)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. In the SQL editor, run `supabase/schema.sql` — creates all tables and seeds the drill library
3. Copy your project URL and anon key

### 3. Configure environment

```bash
cp .env.local.example .env.local
# Fill in your Supabase URL and anon key
```

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## App Flow

1. **Sign up** → parent account created
2. **Onboarding** → add kid: name, age, sport, skill level
3. **Drill Library** → filter by sport + level, pick a drill
4. **Drill Detail** → read instructions, log the session
5. **Dashboard** → see streak, weekly sessions, recent activity
6. **Progress** → milestones, 7-day heatmap, skill coverage breakdown

## Roadmap

- [ ] Video support (Mux or Cloudinary)
- [ ] Training plans (assign weekly drills)
- [ ] AI coaching recommendations (Claude API)

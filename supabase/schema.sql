-- AssistantCoach Database Schema

-- Kids profiles (children of authenticated parents)
create table if not exists kids (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  age integer not null check (age between 4 and 18),
  sport text not null check (sport in ('basketball', 'baseball', 'gymnastics', 'volleyball', 'jiujitsu')),
  skill_level text not null check (skill_level in ('beginner', 'intermediate', 'advanced')),
  avatar_color text not null default 'bg-blue-500',
  created_at timestamptz default now()
);

alter table kids enable row level security;

create policy "Parents manage own kids"
  on kids for all
  using (parent_id = auth.uid())
  with check (parent_id = auth.uid());

-- Drills content library (created_by null = system drill, non-null = user-created)
create table if not exists drills (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  sport text not null check (sport in ('basketball', 'baseball', 'gymnastics', 'volleyball', 'jiujitsu')),
  skill_focus text not null check (skill_focus in ('speed', 'agility', 'strength', 'technique', 'endurance', 'flexibility')),
  difficulty text not null check (difficulty in ('beginner', 'intermediate', 'advanced')),
  age_range text not null check (age_range in ('5-8', '9-12', '13+')),
  duration_minutes integer not null,
  equipment text[] default '{}',
  video_url text,
  thumbnail_url text,
  instructions text[] not null default '{}',
  created_by uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

alter table drills enable row level security;
-- System drills (created_by null) are readable by all; user drills only by their creator
create policy "Drills are readable"
  on drills for select
  using (created_by is null or created_by = auth.uid());
create policy "Users manage their own drills"
  on drills for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Workouts (training plans — each row is one named workout assigned to a day)
create table if not exists training_plans (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid references kids(id) on delete cascade not null,
  name text not null,
  focus text,
  scheduled_day integer check (scheduled_day between 0 and 6), -- 0=Sun … 6=Sat, null=unscheduled
  start_date date not null default current_date,              -- first date workout is active
  end_date date,                                              -- null = recurring indefinitely
  created_at timestamptz default now()
);

alter table training_plans enable row level security;

create policy "Parents manage training plans for their kids"
  on training_plans for all
  using (
    kid_id in (select id from kids where parent_id = auth.uid())
  )
  with check (
    kid_id in (select id from kids where parent_id = auth.uid())
  );

-- Drills within a workout, ordered by display_order
create table if not exists plan_drills (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references training_plans(id) on delete cascade not null,
  drill_id uuid references drills(id) on delete cascade not null,
  display_order integer not null default 0
);

alter table plan_drills enable row level security;

create policy "Parents manage plan drills"
  on plan_drills for all
  using (
    plan_id in (
      select tp.id from training_plans tp
      join kids k on tp.kid_id = k.id
      where k.parent_id = auth.uid()
    )
  )
  with check (
    plan_id in (
      select tp.id from training_plans tp
      join kids k on tp.kid_id = k.id
      where k.parent_id = auth.uid()
    )
  );

-- Session logs (standalone drill completions + workout drill completions via plan_id)
create table if not exists session_logs (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid references kids(id) on delete cascade not null,
  drill_id uuid references drills(id) on delete cascade not null,
  plan_id uuid references training_plans(id) on delete set null,
  completed_at timestamptz default now(),
  rating integer check (rating between 1 and 3),
  notes text
);

alter table session_logs enable row level security;

create policy "Parents manage session logs for their kids"
  on session_logs for all
  using (
    kid_id in (select id from kids where parent_id = auth.uid())
  )
  with check (
    kid_id in (select id from kids where parent_id = auth.uid())
  );

-- Skipped occurrences for recurring workouts
create table if not exists plan_exceptions (
  plan_id uuid references training_plans(id) on delete cascade not null,
  exception_date date not null,
  primary key (plan_id, exception_date)
);

alter table plan_exceptions enable row level security;

create policy "Parents manage plan exceptions"
  on plan_exceptions for all
  using (
    plan_id in (
      select tp.id from training_plans tp
      join kids k on tp.kid_id = k.id
      where k.parent_id = auth.uid()
    )
  )
  with check (
    plan_id in (
      select tp.id from training_plans tp
      join kids k on tp.kid_id = k.id
      where k.parent_id = auth.uid()
    )
  );

-- =====================
-- MIGRATION (run if tables already exist)
-- =====================
-- alter table training_plans add column if not exists focus text;
-- alter table training_plans add column if not exists scheduled_day integer check (scheduled_day between 0 and 6);
-- alter table plan_drills drop column if exists scheduled_day;
-- alter table plan_drills add column if not exists display_order integer not null default 0;
-- alter table session_logs add column if not exists plan_id uuid references training_plans(id) on delete set null;
-- alter table drills add column if not exists created_by uuid references auth.users(id) on delete cascade;
-- drop policy if exists "Drills are publicly readable" on drills;
-- create policy "Drills are readable" on drills for select using (created_by is null or created_by = auth.uid());
-- create policy "Users manage their own drills" on drills for all using (created_by = auth.uid()) with check (created_by = auth.uid());
-- alter table training_plans add column if not exists start_date date not null default current_date;
-- alter table training_plans add column if not exists end_date date;
-- update training_plans set start_date = created_at::date where start_date = current_date and created_at < now() - interval '1 hour';
-- create table if not exists plan_exceptions (plan_id uuid references training_plans(id) on delete cascade not null, exception_date date not null, primary key (plan_id, exception_date));
-- alter table plan_exceptions enable row level security;
-- create policy "Parents manage plan exceptions" on plan_exceptions for all using (plan_id in (select tp.id from training_plans tp join kids k on tp.kid_id = k.id where k.parent_id = auth.uid())) with check (plan_id in (select tp.id from training_plans tp join kids k on tp.kid_id = k.id where k.parent_id = auth.uid()));

-- Reusable workout templates (created_by null = system, non-null = user-created)
create table if not exists workout_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  focus text,
  sport text not null check (sport in ('basketball', 'baseball', 'gymnastics', 'volleyball', 'jiujitsu')),
  difficulty text not null check (difficulty in ('beginner', 'intermediate', 'advanced')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table workout_templates enable row level security;

create policy "Workout templates are readable"
  on workout_templates for select
  using (created_by is null or created_by = auth.uid());
create policy "Users manage their own templates"
  on workout_templates for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Drills within a template, ordered
create table if not exists template_drills (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references workout_templates(id) on delete cascade not null,
  drill_id uuid references drills(id) on delete cascade not null,
  display_order integer not null default 0
);

alter table template_drills enable row level security;

create policy "Template drills are readable"
  on template_drills for select
  using (
    template_id in (select id from workout_templates where created_by is null or created_by = auth.uid())
  );
create policy "Users manage drills in their own templates"
  on template_drills for all
  using (
    template_id in (select id from workout_templates where created_by = auth.uid())
  )
  with check (
    template_id in (select id from workout_templates where created_by = auth.uid())
  );

-- User favorites
create table if not exists workout_favorites (
  user_id uuid references auth.users(id) on delete cascade not null,
  template_id uuid references workout_templates(id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (user_id, template_id)
);

alter table workout_favorites enable row level security;

create policy "Users manage their own favorites"
  on workout_favorites for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =====================
-- TRAINEE ROLE
-- =====================

-- Link a Supabase auth user to a kid as their trainee
alter table kids add column if not exists trainee_user_id uuid references auth.users(id) on delete set null;

-- One-time invite tokens that trainers generate and share with trainees
create table if not exists trainee_invites (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid references kids(id) on delete cascade not null,
  token uuid not null unique default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete cascade not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

alter table trainee_invites enable row level security;

create policy "Trainers manage their invites"
  on trainee_invites for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Trainees can read their own invite (needed to display invite info before accepting)
create policy "Authenticated users can read invites"
  on trainee_invites for select
  using (auth.uid() is not null);

-- RLS: trainees can view their linked kid profile
create policy "Trainees can view their linked kid"
  on kids for select
  using (trainee_user_id = auth.uid());

-- RLS: trainees can read training plans for their kid
create policy "Trainees can view their training plans"
  on training_plans for select
  using (
    kid_id in (select id from kids where trainee_user_id = auth.uid())
  );

-- RLS: trainees can read plan drills for their plans
create policy "Trainees can view their plan drills"
  on plan_drills for select
  using (
    plan_id in (
      select tp.id from training_plans tp
      join kids k on tp.kid_id = k.id
      where k.trainee_user_id = auth.uid()
    )
  );

-- RLS: trainees can insert and delete session logs for their kid
create policy "Trainees can manage their session logs"
  on session_logs for all
  using (
    kid_id in (select id from kids where trainee_user_id = auth.uid())
  )
  with check (
    kid_id in (select id from kids where trainee_user_id = auth.uid())
  );

-- RLS: trainees can read plan exceptions for their kid
create policy "Trainees can view their plan exceptions"
  on plan_exceptions for select
  using (
    plan_id in (
      select tp.id from training_plans tp
      join kids k on tp.kid_id = k.id
      where k.trainee_user_id = auth.uid()
    )
  );

-- =====================
-- WORKOUT SESSIONS
-- =====================
-- One row per fully-completed workout (all drills checked off)

create table if not exists workout_sessions (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid references kids(id) on delete cascade not null,
  plan_id uuid references training_plans(id) on delete cascade not null,
  completed_at timestamptz default now()
);

alter table workout_sessions enable row level security;

create policy "Parents manage workout sessions"
  on workout_sessions for all
  using (kid_id in (select id from kids where parent_id = auth.uid()))
  with check (kid_id in (select id from kids where parent_id = auth.uid()));

create policy "Trainees view own workout sessions"
  on workout_sessions for select
  using (kid_id in (select id from kids where trainee_user_id = auth.uid()));

-- =====================
-- KID PROFILE FIELDS
-- =====================

alter table kids add column if not exists weight numeric;
alter table kids add column if not exists height numeric;
alter table kids add column if not exists avatar_url text;

-- RLS: trainees can update their own weight/height/avatar_url
create policy "Trainees can update their own profile"
  on kids for update
  using (trainee_user_id = auth.uid())
  with check (trainee_user_id = auth.uid());

-- Storage bucket for kid profile pictures
insert into storage.buckets (id, name, public)
values ('kid-avatars', 'kid-avatars', true)
on conflict (id) do nothing;

create policy "Public read kid avatars"
  on storage.objects for select
  using (bucket_id = 'kid-avatars');

create policy "Parents manage kid avatars"
  on storage.objects for all
  using (
    bucket_id = 'kid-avatars'
    and auth.uid() in (
      select parent_id from kids where id::text = split_part(name, '/', 1)
    )
  )
  with check (
    bucket_id = 'kid-avatars'
    and auth.uid() in (
      select parent_id from kids where id::text = split_part(name, '/', 1)
    )
  );

create policy "Trainees manage own avatar"
  on storage.objects for all
  using (
    bucket_id = 'kid-avatars'
    and auth.uid() in (
      select trainee_user_id from kids
      where id::text = split_part(name, '/', 1)
        and trainee_user_id is not null
    )
  )
  with check (
    bucket_id = 'kid-avatars'
    and auth.uid() in (
      select trainee_user_id from kids
      where id::text = split_part(name, '/', 1)
        and trainee_user_id is not null
    )
  );

-- =====================
-- WORKOUT SESSION FEEDBACK
-- =====================

alter table workout_sessions add column if not exists rating smallint;
alter table workout_sessions add column if not exists notes text;

-- Migration shortcuts (run if altering an existing database):
-- alter table kids add column if not exists trainee_user_id uuid references auth.users(id) on delete set null;
-- alter table kids add column if not exists weight numeric;
-- alter table kids add column if not exists height numeric;
-- alter table kids add column if not exists avatar_url text;
-- alter table workout_sessions add column if not exists rating smallint;
-- alter table workout_sessions add column if not exists notes text;

-- Add volleyball and jiujitsu sport support (run on existing databases):
-- alter table kids drop constraint if exists kids_sport_check;
-- alter table kids add constraint kids_sport_check check (sport in ('basketball', 'baseball', 'gymnastics', 'volleyball', 'jiujitsu'));
-- alter table drills drop constraint if exists drills_sport_check;
-- alter table drills add constraint drills_sport_check check (sport in ('basketball', 'baseball', 'gymnastics', 'volleyball', 'jiujitsu'));
-- alter table workout_templates drop constraint if exists workout_templates_sport_check;
-- alter table workout_templates add constraint workout_templates_sport_check check (sport in ('basketball', 'baseball', 'gymnastics', 'volleyball', 'jiujitsu'));

-- =====================
-- SEED DATA: Drill Library
-- =====================

insert into drills (title, description, sport, skill_focus, difficulty, age_range, duration_minutes, equipment, instructions) values

-- BASKETBALL - Beginner
('Dribble in Place', 'Learn to control the basketball while standing still. Great foundation for all ball-handling skills.', 'basketball', 'technique', 'beginner', '5-8', 5, '{"basketball"}',
  '{"Stand with feet shoulder-width apart", "Hold ball at waist height with dominant hand", "Push ball down with fingertips — not palm", "Let ball bounce back up naturally", "Repeat for 30 seconds, then switch hands"}'),

('Around the World Dribble', 'Move the ball around your body to improve hand speed and coordination.', 'basketball', 'agility', 'beginner', '5-8', 8, '{"basketball"}',
  '{"Stand with feet shoulder-width apart", "Dribble the ball around your right leg using both hands", "Then around your left leg", "Then in a figure-8 between your legs", "Do 3 sets of 30 seconds"}'),

('Lay-up Lines', 'Practice the fundamental basket finish — approach from the right side, then the left.', 'basketball', 'technique', 'beginner', '9-12', 10, '{"basketball","hoop"}',
  '{"Start 3 steps away from the basket at a 45-degree angle", "Take 2 dribbles toward the hoop", "Jump off your left foot when shooting right-handed", "Aim for the top corner of the backboard square", "Alternate sides after each make, 10 reps per side"}'),

-- BASKETBALL - Intermediate
('Cone Dribbling Slalom', 'Weave through cones at speed to build handle under pressure and change of direction.', 'basketball', 'agility', 'intermediate', '9-12', 12, '{"basketball","6 cones"}',
  '{"Set up 6 cones in a straight line, 3 feet apart", "Dribble through the cones using your dominant hand going forward", "Use your off-hand coming back", "Focus on keeping the ball below your knee", "Time yourself and try to beat your record each set", "Do 5 passes"}'),

('Free Throw Routine', 'Build a consistent pre-shot routine to improve free throw percentage.', 'basketball', 'technique', 'intermediate', '9-12', 15, '{"basketball","hoop"}',
  '{"Step to the line with your shooting foot slightly forward", "Bounce the ball 3 times — same every time", "Find your target: the front of the rim", "Bend knees slightly, keep elbow under the ball", "Follow through and hold your hand in the net position", "Shoot 50 free throws, track makes vs misses"}'),

-- BASKETBALL - Advanced
('Full Court Sprints with Ball', 'Condition and challenge ball control at game speed across the full court.', 'basketball', 'speed', 'advanced', '13+', 15, '{"basketball","full court"}',
  '{"Start at one baseline with ball in hand", "Sprint at full speed while dribbling to the other baseline", "Stay in control — do not lose the ball", "Rest 20 seconds, then sprint back", "Complete 8 round trips", "Track your fastest time"}'),

-- BASEBALL - Beginner
('Soft Toss Hitting', 'Parent tosses ball underhand from the side while kid practices contact and swing mechanics.', 'baseball', 'technique', 'beginner', '5-8', 10, '{"bat","tennis balls or soft balls","batting tee (optional)"}',
  '{"Set up with feet shoulder-width apart, knees slightly bent", "Hold bat at shoulder height with both hands", "Parent tosses ball underhand from 3 feet to the side", "Rotate hips and swing through the ball", "Focus on watching the ball hit the bat", "30 swings total, take 5 tee swings to warm up"}'),

('Throwing Mechanics', 'Learn the four-seam grip and basic throwing motion with correct footwork.', 'baseball', 'technique', 'beginner', '5-8', 10, '{"baseball","glove"}',
  '{"Hold ball with index and middle fingers across the seams", "Stand sideways to your target, glove toward target", "Step with opposite foot as you throw", "Release ball at 12 o''clock, snap wrist down", "Follow through so throwing hand ends near opposite hip", "Throw 20 times at 30 feet, focus on form not speed"}'),

('Ground Ball Fielding', 'Practice the ready position, footwork, and secure catch on ground balls.', 'baseball', 'technique', 'intermediate', '9-12', 12, '{"baseball","glove","flat surface"}',
  '{"Start in athletic ready position: knees bent, glove low", "Have partner roll ground balls to each side", "Move feet to get in front of ball — do not reach", "Field ball with two hands, glove fingers pointing down", "Transfer ball to throwing hand quickly", "Field 20 ground balls: 10 straight, 5 right, 5 left"}'),

-- BASEBALL - Intermediate
('Pitching Windup Mechanics', 'Build a repeatable pitching motion from windup through release.', 'baseball', 'technique', 'intermediate', '9-12', 15, '{"baseball","glove","pitching mound or flat surface"}',
  '{"Start with feet on rubber, facing home plate", "Bring hands together, then leg kick to hip height", "Stride toward plate — stride foot lands at 45 degrees", "Keep elbow at shoulder height during arm circle", "Release at extension, then follow through across body", "Throw 30 pitches at 50% effort focusing on mechanics"}'),

('Base Running: First to Third', 'Practice reading hits and running an aggressive arc from first to third base.', 'baseball', 'speed', 'intermediate', '9-12', 12, '{"baseball bases or cones"}',
  '{"Set up bases at regulation or scaled distances", "Start at first base in leadoff position", "On signal, sprint to second — hit the inside corner of the base", "Read the signal: stop at second or push to third", "Round third if going home — cut inside the base", "Run 10 reps: 5 stopping at second, 5 pushing to third"}'),

-- BASEBALL - Advanced
('Live Batting Practice', 'Full speed pitch recognition and hitting against real pitching.', 'baseball', 'technique', 'advanced', '13+', 20, '{"bat","baseballs","pitching partner or machine"}',
  '{"Warm up with 10 tee swings", "Pitcher throws at 70-80% of game speed", "Focus on pitch recognition: ball vs strike", "Do not expand the strike zone — take balls", "Drive every swing to the opposite field", "Take 40 pitches in 4 rounds of 10"}'),

-- GYMNASTICS - Beginner
('Forward Roll', 'The foundational gymnastics skill: a controlled roll forward from standing.', 'gymnastics', 'technique', 'beginner', '5-8', 8, '{"gymnastics mat"}',
  '{"Stand at the edge of the mat with feet together", "Crouch down and place hands flat on the mat, shoulder-width", "Tuck chin to chest and push off with feet", "Roll smoothly over the back of your head and shoulders", "Pull knees in tight, roll to standing", "Practice 10 times slowly before adding speed"}'),

('Cartwheel on a Line', 'A straight cartwheel using a taped line or edge of mat for alignment.', 'gymnastics', 'technique', 'beginner', '5-8', 10, '{"gymnastics mat","tape line"}',
  '{"Place tape in a straight line on the mat", "Stand at one end, lunge forward with dominant leg", "Place first hand, then second on the line", "Kick legs up and over — keep them straight", "Land one foot then the other on the line", "Do 10 cartwheels per direction"}'),

('Bridge Pose and Hold', 'Develop the back flexibility needed for back walkovers and other skills.', 'gymnastics', 'flexibility', 'beginner', '5-8', 8, '{"gymnastics mat"}',
  '{"Lie on your back with knees bent, feet flat", "Place hands beside your ears, fingers pointing toward shoulders", "Push up through hands and feet, arching your back", "Hold for 10 seconds, focusing on straight arms and legs", "Slowly lower back down", "Repeat 5 times, increasing hold time each set"}'),

-- GYMNASTICS - Intermediate
('Back Walkover Progressions', 'Step-by-step drills to safely build toward an unassisted back walkover.', 'gymnastics', 'flexibility', 'intermediate', '9-12', 20, '{"gymnastics mat","foam wedge or spotter"}',
  '{"Warm up with 3 bridge holds (30 seconds each)", "Kick over from bridge: start in bridge, kick one leg up and over", "Handstand bridge: kick to handstand against wall, lower to bridge", "With spotter: stand, back bend to bridge, kick over", "Full walkover attempt: use spotter until consistent", "10 reps of each progression level"}'),

('Round Off', 'Combine a cartwheel with a snap-down finish — foundation for back tumbling.', 'gymnastics', 'technique', 'intermediate', '9-12', 15, '{"gymnastics mat","60-foot runway"}',
  '{"Run 3 hurdle steps to build momentum", "Hurdle: jump to lunge position", "Place both hands down simultaneously, kick legs up together", "Snap feet down together — do not split landing", "Land in a solid athletic position, arms up", "15 reps, focus on the snap-down timing"}'),

-- GYMNASTICS - Advanced
('Back Handspring Progressions', 'Structured progression toward an unassisted back handspring using spotting and drills.', 'gymnastics', 'technique', 'advanced', '13+', 25, '{"gymnastics mat","stacked mats","qualified spotter"}',
  '{"Always work with a qualified spotter or coach", "Drill 1: Seated snap-down — jump backward from seated position", "Drill 2: Back handspring on stacked mats — lower height removes fear", "Drill 3: Spotted back handspring on floor — spotter at back and wrist", "Drill 4: Back handspring on rod floor or trampoline for feel", "Full attempt: spotted, then semi-spotted, then solo when ready", "Never rush progressions — safety first"}');

-- =====================
-- SEED DATA: Volleyball Drills
-- =====================

insert into drills (title, description, sport, skill_focus, difficulty, age_range, duration_minutes, equipment, instructions) values

-- VOLLEYBALL - Beginner
('Underhand Serve', 'Learn the basic underhand serve to consistently put the ball in play. Perfect for young players just starting out.', 'volleyball', 'technique', 'beginner', '5-8', 8, '{"volleyball"}',
  '{"Stand 5 feet from the net or serving line", "Hold the ball in your non-dominant hand at waist height", "Step forward with your opposite foot as you swing", "Strike the ball with a closed fist at the base", "Follow through toward your target", "Practice 20 serves, aim for inside the court"}'),

('Forearm Pass (Bump)', 'The forearm pass is the foundation of volleyball defense. Learn to control incoming balls with your forearms.', 'volleyball', 'technique', 'beginner', '5-8', 10, '{"volleyball"}',
  '{"Stand with feet shoulder-width apart, knees bent", "Clasp hands together, thumbs parallel and flat", "Keep arms straight and at a 45-degree angle from your body", "Move your whole body behind the ball before contact", "Bump ball upward using your forearms — no wrist snap", "Toss ball to yourself and practice 30 passes"}'),

('Wall Setting', 'Practice the overhead set against a wall to build fingertip control without needing a partner.', 'volleyball', 'technique', 'beginner', '9-12', 10, '{"volleyball"}',
  '{"Stand 2 feet from a wall", "Form a triangle with your thumbs and index fingers above your forehead", "Toss ball against the wall to eye level", "Set it back using fingertips — not palms", "Keep elbows bent and push through the ball at contact", "Do 3 sets of 20 consecutive sets without dropping"}'),

-- VOLLEYBALL - Intermediate
('Spike Approach', 'Drill the 4-step approach and arm swing to build a consistent attacking motion.', 'volleyball', 'technique', 'intermediate', '9-12', 12, '{"volleyball"}',
  '{"Learn the 4-step approach: right-left-right-left for right-handers", "Drive both arms back as your last two feet plant", "Jump off both feet simultaneously, reach high and forward", "Swing your dominant arm from high to low in a fast arc", "Land balanced on both feet", "Add a tossed ball and practice 20 full approach swings"}'),

('Defensive Dig', 'React and dig balls hit to your left and right to build defensive coverage and court awareness.', 'volleyball', 'agility', 'intermediate', '9-12', 12, '{"volleyball"}',
  '{"Start in a defensive ready stance: low hips, weight on balls of feet", "Have a partner point left or right — shuffle quickly 2-3 steps", "Get your platform behind the ball and pass it back up", "Progress to partner tossing balls to alternating sides", "Focus on getting low rather than reaching with your arms", "Do 3 sets of 10 reps each direction"}'),

('Zone Serving', 'Develop serving accuracy by targeting specific zones of the court to pressure the opponent.', 'volleyball', 'technique', 'intermediate', '13+', 15, '{"volleyball"}',
  '{"Mark 6 zones on the opposite side with cones or tape", "Serve from behind the end line", "Call out a target zone before each serve", "Track results: try to hit each zone 3 times", "Mix deep corner serves with short float serves", "Goal: 15 out of 18 serves land in the intended zone"}'),

-- VOLLEYBALL - Advanced
('Jump Serve', 'Progress toward a powerful jump serve using a full toss, approach, and attack motion.', 'volleyball', 'speed', 'advanced', '13+', 15, '{"volleyball"}',
  '{"Toss ball high and slightly forward from behind the end line", "Take 3-4 steps to build momentum, time your jump to the toss", "Strike ball at the peak of your reach with arm fully extended", "Snap your wrist for topspin to drive the ball down into the court", "Start 6 feet back to allow room, move to the line as timing improves", "10 reps focusing on toss consistency, then 10 focusing on power"}'),

('Transition Attack', 'Simulate match conditions: defend a dig, transition back, and attack on the next set.', 'volleyball', 'agility', 'advanced', '13+', 20, '{"volleyball"}',
  '{"Start in back-row defensive position", "Partner hits a down ball — you dig it to the setter target", "Quickly transition forward to attack position off the net", "Setter delivers a set — attack with a full approach", "Reset and repeat from the opposite side", "Do 5 reps each side, emphasizing speed of transition"}'),

('Blocking Footwork', 'Sharpen your block timing and lateral movement to seal the net against outside and middle attacks.', 'volleyball', 'technique', 'advanced', '13+', 15, '{"volleyball"}',
  '{"Start at the middle of the net in a ready position", "Shuffle to the pin on the coach''s signal — no crossover steps", "Jump and reach with both hands, arms close together and straight", "Lead with your outside hand to cut off the cross-court angle", "Land balanced and immediately reset to the middle", "Do 15 reps alternating left and right blocks"}'),

-- =====================
-- SEED DATA: Jiu-Jitsu Drills
-- =====================

-- JIUJITSU - Beginner
('Shrimping (Hip Escape)', 'Shrimping is the most fundamental movement in jiu-jitsu. Build the reflex of creating space from your back.', 'jiujitsu', 'flexibility', 'beginner', '5-8', 8, '{"mat"}',
  '{"Lie flat on your back, knees bent, feet flat on mat", "Bridge up on one shoulder and plant the same-side foot", "Shoot your hips away from your planted foot in a curved arc", "Your body forms a C-shape — repeat on the other side", "Travel continuously down the mat for 20 reps", "Focus on smooth hip motion first, then build speed"}'),

('Breakfall and Rolling', 'Safe breakfall and rolling drills build body awareness and comfort with hitting the mat — essential before any technique.', 'jiujitsu', 'technique', 'beginner', '5-8', 8, '{"mat"}',
  '{"Tuck your chin to your chest before any roll", "Place one hand on the mat and roll diagonally over that shoulder", "Never roll directly on the top of your head", "Keep arms rounded, not straight, to absorb impact", "Roll smoothly onto your back and come to standing", "Practice 10 rolls each shoulder, slow and controlled"}'),

('Guard Retention', 'Learn to maintain guard position when a partner tries to pass, building hip mobility and spatial awareness.', 'jiujitsu', 'technique', 'beginner', '9-12', 12, '{"mat","training partner"}',
  '{"Start in open guard with partner kneeling in front of you", "Partner tries to pass around your legs — you use feet to frame and redirect", "Keep your feet between you and your partner at all times", "Hip escape to re-establish guard if partially passed", "Switch roles every 2 minutes", "3 rounds of 2 minutes, focus on movement not submission"}'),

-- JIUJITSU - Intermediate
('Triangle Choke Entry', 'Drill the mechanical entry to the triangle choke from closed guard — one of the most common submissions.', 'jiujitsu', 'technique', 'intermediate', '9-12', 15, '{"mat","training partner"}',
  '{"Start in closed guard with partner standing or posturing up", "Break partner''s posture by pulling them forward with both arms", "Push one of their arms across their centerline using your leg", "Shoot your leg up and over their shoulder, locking behind their head", "Close the triangle by locking your ankle behind your opposite knee", "Practice the entry only for 10 reps each side — partner must tap when locked"}'),

('Armbar from Guard', 'Practice the foundational armbar from closed guard, focusing on hip extension and arm control.', 'jiujitsu', 'technique', 'intermediate', '9-12', 15, '{"mat","training partner"}',
  '{"Start in closed guard", "Control one wrist with both hands and pivot your hips 90 degrees toward that arm", "Throw your top leg over partner''s head", "Open guard and squeeze knees together above and below their elbow", "Extend hips upward slowly — partner taps at first pressure", "10 reps each arm at a slow, controlled pace"}'),

('Double Leg Takedown', 'Build the foundational wrestling takedown used in jiu-jitsu: level change, penetration step, finish.', 'jiujitsu', 'strength', 'intermediate', '13+', 15, '{"mat","training partner"}',
  '{"Stand in wrestling stance: dominant foot back, hands up", "Shoot: lower your level by bending your knees, not hunching your back", "Step deeply between partner''s legs with your lead foot", "Drive your shoulder into partner''s hip and wrap both arms behind their knees", "Lift and drive forward to finish — partner lands safely on the mat", "10 slow-motion reps for technique, then 10 at speed with light resistance"}'),

-- JIUJITSU - Advanced
('Back Take from Turtle', 'Drill the sequence for taking the back from an opponent in turtle position — a high-percentage match situation.', 'jiujitsu', 'technique', 'advanced', '13+', 20, '{"mat","training partner"}',
  '{"Partner is in turtle position: on all fours with head tucked", "Establish a seatbelt grip: one arm over their shoulder, one arm under their opposite arm", "Insert your lower hook (leg) into partner''s hip from the side", "Roll to your back taking partner with you, insert the second hook", "Lock your hands tight on the seatbelt grip — rear naked choke position", "Partner attempts escape; 5 reps each side at moderate resistance"}'),

('De La Riva Sweep', 'Build the De La Riva hook and fundamental sweep to off-balance standing opponents from seated guard.', 'jiujitsu', 'agility', 'advanced', '13+', 20, '{"mat","training partner"}',
  '{"Start seated as partner stands in front of you", "Hook your outside leg around their lead leg — this is the De La Riva hook", "Grip their far ankle and their sleeve or collar with opposite hands", "Extend your hook leg to break their base while pulling the ankle toward you", "Sweep them to the side and follow on top to a dominant position", "5 reps each side, progressing from light to medium resistance"}'),

('Ashi Garami (Leg Control)', 'Learn the foundational leg entanglement position before attempting any leg lock submissions.', 'jiujitsu', 'strength', 'advanced', '13+', 20, '{"mat","training partner"}',
  '{"Face a seated or kneeling partner", "Sit through and triangle your legs around their leg in ashi garami position", "Establish inside heel control with a two-on-one grip", "Turn toward the leg you control — keep your frame tight", "Elevate and stretch for a heel hook entry slowly — partner taps at any pressure", "Train position-only first: 5-minute positional rounds before working any finish"}');

-- =====================
-- SEED DATA: Workout Templates
-- =====================

do $$
declare
  bball_beg uuid := '11111111-1111-1111-1111-111111111111';
  bball_int uuid := '22222222-2222-2222-2222-222222222222';
  base_fund uuid := '33333333-3333-3333-3333-333333333333';
  base_game uuid := '44444444-4444-4444-4444-444444444444';
  gym_beg   uuid := '55555555-5555-5555-5555-555555555555';
  gym_int   uuid := '66666666-6666-6666-6666-666666666666';
  vball_beg uuid := '77777777-7777-7777-7777-777777777777';
  vball_int uuid := '88888888-8888-8888-8888-888888888888';
  jjt_beg   uuid := '99999999-9999-9999-9999-999999999999';
  jjt_adv   uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
begin
  insert into workout_templates (id, name, focus, sport, difficulty) values
    (bball_beg, 'Beginner Ball Handling',    'Build foundational dribbling skills and learn how to finish at the basket',      'basketball', 'beginner'),
    (bball_int, 'Shooting & Conditioning',   'Sharpen your free throw routine and build game-speed endurance',                  'basketball', 'intermediate'),
    (base_fund, 'Hitting Fundamentals',      'Develop proper swing mechanics and throwing form from the ground up',             'baseball',   'beginner'),
    (base_game, 'Game Day Prep',             'Full session covering pitching mechanics, base running, and live hitting',         'baseball',   'intermediate'),
    (gym_beg,   'Gymnastics Foundations',    'Learn the essential beginner skills safely with correct technique',                'gymnastics', 'beginner'),
    (gym_int,   'Tumbling Progressions',     'Progress toward intermediate tumbling with structured skill-building drills',      'gymnastics', 'intermediate'),
    (vball_beg, 'Volleyball Fundamentals',   'Master the three core skills every player needs: serve, pass, and set',           'volleyball', 'beginner'),
    (vball_int, 'Attack & Defense Session',  'Build your offensive approach and sharpen defensive reactions',                    'volleyball', 'intermediate'),
    (jjt_beg,   'BJJ Basics',                'Build the foundational movements and positions every beginner must know',          'jiujitsu',   'beginner'),
    (jjt_adv,   'Submission Chains',         'Link your guard submissions and back takes into smooth positional sequences',      'jiujitsu',   'advanced')
  on conflict (id) do nothing;

  if not exists (select 1 from template_drills where template_id = bball_beg) then
    insert into template_drills (template_id, drill_id, display_order) values
      (bball_beg, (select id from drills where title = 'Dribble in Place'         and created_by is null limit 1), 0),
      (bball_beg, (select id from drills where title = 'Around the World Dribble' and created_by is null limit 1), 1),
      (bball_beg, (select id from drills where title = 'Lay-up Lines'             and created_by is null limit 1), 2);
  end if;

  if not exists (select 1 from template_drills where template_id = bball_int) then
    insert into template_drills (template_id, drill_id, display_order) values
      (bball_int, (select id from drills where title = 'Cone Dribbling Slalom'       and created_by is null limit 1), 0),
      (bball_int, (select id from drills where title = 'Free Throw Routine'           and created_by is null limit 1), 1),
      (bball_int, (select id from drills where title = 'Full Court Sprints with Ball' and created_by is null limit 1), 2);
  end if;

  if not exists (select 1 from template_drills where template_id = base_fund) then
    insert into template_drills (template_id, drill_id, display_order) values
      (base_fund, (select id from drills where title = 'Soft Toss Hitting'   and created_by is null limit 1), 0),
      (base_fund, (select id from drills where title = 'Throwing Mechanics'  and created_by is null limit 1), 1),
      (base_fund, (select id from drills where title = 'Ground Ball Fielding' and created_by is null limit 1), 2);
  end if;

  if not exists (select 1 from template_drills where template_id = base_game) then
    insert into template_drills (template_id, drill_id, display_order) values
      (base_game, (select id from drills where title = 'Pitching Windup Mechanics'      and created_by is null limit 1), 0),
      (base_game, (select id from drills where title = 'Base Running: First to Third'   and created_by is null limit 1), 1),
      (base_game, (select id from drills where title = 'Live Batting Practice'           and created_by is null limit 1), 2);
  end if;

  if not exists (select 1 from template_drills where template_id = gym_beg) then
    insert into template_drills (template_id, drill_id, display_order) values
      (gym_beg, (select id from drills where title = 'Forward Roll'          and created_by is null limit 1), 0),
      (gym_beg, (select id from drills where title = 'Cartwheel on a Line'   and created_by is null limit 1), 1),
      (gym_beg, (select id from drills where title = 'Bridge Pose and Hold'  and created_by is null limit 1), 2);
  end if;

  if not exists (select 1 from template_drills where template_id = gym_int) then
    insert into template_drills (template_id, drill_id, display_order) values
      (gym_int, (select id from drills where title = 'Back Walkover Progressions' and created_by is null limit 1), 0),
      (gym_int, (select id from drills where title = 'Round Off'                  and created_by is null limit 1), 1);
  end if;

  if not exists (select 1 from template_drills where template_id = vball_beg) then
    insert into template_drills (template_id, drill_id, display_order) values
      (vball_beg, (select id from drills where title = 'Underhand Serve'       and created_by is null limit 1), 0),
      (vball_beg, (select id from drills where title = 'Forearm Pass (Bump)'   and created_by is null limit 1), 1),
      (vball_beg, (select id from drills where title = 'Wall Setting'          and created_by is null limit 1), 2);
  end if;

  if not exists (select 1 from template_drills where template_id = vball_int) then
    insert into template_drills (template_id, drill_id, display_order) values
      (vball_int, (select id from drills where title = 'Spike Approach'   and created_by is null limit 1), 0),
      (vball_int, (select id from drills where title = 'Defensive Dig'    and created_by is null limit 1), 1),
      (vball_int, (select id from drills where title = 'Zone Serving'     and created_by is null limit 1), 2);
  end if;

  if not exists (select 1 from template_drills where template_id = jjt_beg) then
    insert into template_drills (template_id, drill_id, display_order) values
      (jjt_beg, (select id from drills where title = 'Shrimping (Hip Escape)'    and created_by is null limit 1), 0),
      (jjt_beg, (select id from drills where title = 'Breakfall and Rolling'     and created_by is null limit 1), 1),
      (jjt_beg, (select id from drills where title = 'Guard Retention'           and created_by is null limit 1), 2);
  end if;

  if not exists (select 1 from template_drills where template_id = jjt_adv) then
    insert into template_drills (template_id, drill_id, display_order) values
      (jjt_adv, (select id from drills where title = 'Triangle Choke Entry'    and created_by is null limit 1), 0),
      (jjt_adv, (select id from drills where title = 'Armbar from Guard'       and created_by is null limit 1), 1),
      (jjt_adv, (select id from drills where title = 'Back Take from Turtle'   and created_by is null limit 1), 2);
  end if;
end $$;

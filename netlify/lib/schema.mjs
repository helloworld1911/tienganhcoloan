// Lược đồ CSDL – được tạo tự động ở lần gọi API đầu tiên (CREATE ... IF NOT EXISTS)
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  grade INT,
  school_year TEXT,
  join_code TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin','teacher','student')),
  class_id INT REFERENCES classes(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS users_class_idx ON users(class_id);
CREATE TABLE IF NOT EXISTS exams (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  grade INT,
  time_limit INT,
  source_name TEXT,
  content JSONB NOT NULL,
  question_count INT NOT NULL DEFAULT 0,
  total_points NUMERIC NOT NULL DEFAULT 0,
  tags TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT,
  opens_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  time_limit INT,
  max_attempts INT NOT NULL DEFAULT 0,
  show_answers TEXT NOT NULL DEFAULT 'after_submit' CHECK (show_answers IN ('after_submit','after_due','never')),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignments_class_idx ON assignments(class_id);
CREATE TABLE IF NOT EXISTS attempts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id INT,
  assignment_id INT REFERENCES assignments(id) ON DELETE CASCADE,
  exam_id INT REFERENCES exams(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'assignment' CHECK (kind IN ('assignment','practice')),
  title TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted')),
  content JSONB,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB,
  score NUMERIC,
  max_score NUMERIC,
  percent NUMERIC,
  needs_grading BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  duration_sec INT
);
CREATE INDEX IF NOT EXISTS attempts_user_idx ON attempts(user_id, submitted_at);
CREATE INDEX IF NOT EXISTS attempts_assignment_idx ON attempts(assignment_id);
CREATE TABLE IF NOT EXISTS attempt_items (
  attempt_id INT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  qid TEXT NOT NULL,
  user_id INT NOT NULL,
  class_id INT,
  topic TEXT,
  qtype TEXT,
  correct BOOLEAN,
  earned NUMERIC NOT NULL DEFAULT 0,
  max NUMERIC NOT NULL DEFAULT 0,
  pending BOOLEAN NOT NULL DEFAULT false,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, qid)
);
CREATE INDEX IF NOT EXISTS attempt_items_class_topic_idx ON attempt_items(class_id, topic);
CREATE INDEX IF NOT EXISTS attempt_items_user_idx ON attempt_items(user_id, topic);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  name TEXT,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  chunk_size INT NOT NULL,
  chunks INT NOT NULL,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(lower(email)) WHERE email IS NOT NULL
`;

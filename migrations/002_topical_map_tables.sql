-- Migration: 002_topical_map_tables.sql
-- Run in Supabase SQL Editor

-- 1. Topical Maps container
CREATE TABLE topical_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  stats jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Topics — nodes in the topical map
CREATE TABLE topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid REFERENCES topical_maps(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES topics(id) ON DELETE SET NULL,
  topic_type text NOT NULL CHECK (topic_type IN ('pillar', 'cluster', 'supporting', 'brand_review')),
  content_type text NOT NULL CHECK (content_type IN ('pillar_page', 'guide', 'educational', 'comparison', 'recovery_guide', 'prevention', 'brand_review', 'listicle', 'glossary')),
  title text NOT NULL,
  slug text UNIQUE,
  description text,
  target_keyword text,
  secondary_keywords jsonb DEFAULT '[]',
  search_volume int DEFAULT 0,
  keyword_difficulty int DEFAULT 0,
  business_value int DEFAULT 50,
  priority_score int DEFAULT 0,
  content_status text DEFAULT 'planned' CHECK (content_status IN ('planned', 'in_progress', 'draft', 'review', 'published')),
  content_id uuid,
  brand_id uuid,
  review_id uuid,
  dependencies jsonb DEFAULT '[]',
  internal_links_to jsonb DEFAULT '[]',
  sort_order int DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_topics_map_id ON topics(map_id);
CREATE INDEX idx_topics_parent_id ON topics(parent_id);
CREATE INDEX idx_topics_content_status ON topics(content_status);
CREATE INDEX idx_topics_priority_score ON topics(priority_score DESC);
CREATE INDEX idx_topics_content_type ON topics(content_type);

-- 3. Content — generated articles for non-review types
CREATE TABLE content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid REFERENCES topics(id) ON DELETE SET NULL,
  content_type text NOT NULL,
  title text,
  headline text,
  slug text UNIQUE NOT NULL,
  meta_description text,
  summary text,
  full_article text,
  sections jsonb DEFAULT '[]',
  faq jsonb DEFAULT '[]',
  schema_json jsonb,
  internal_links jsonb DEFAULT '[]',
  sources jsonb DEFAULT '[]',
  word_count int DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  ai_model text,
  ai_audit jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_content_slug ON content(slug);
CREATE INDEX idx_content_topic_id ON content(topic_id);

-- Add FK from topics.content_id to content.id (after content table exists)
ALTER TABLE topics ADD CONSTRAINT fk_topics_content FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE SET NULL;

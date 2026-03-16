# Intellectual — Backend Architecture Plan

**App:** Intellectual (Daily Fact Learning iOS App)
**Document Version:** 1.0
**Date:** 2026-03-08
**Audience:** Backend & iOS developers

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Anonymous Identity System](#2-anonymous-identity-system)
3. [Database Schema](#3-database-schema)
4. [API Endpoints](#4-api-endpoints)
5. [AI Fact Generation Pipeline](#5-ai-fact-generation-pipeline)
6. [No-Repeat Algorithm](#6-no-repeat-algorithm)
7. [Recommendation Engine](#7-recommendation-engine)
8. [For You Feed Logic](#8-for-you-feed-logic)
9. [Streak & Progress Tracking](#9-streak--progress-tracking)
10. [iOS Integration Notes](#10-ios-integration-notes)
11. [Phased Rollout](#11-phased-rollout)

---

## 1. Architecture Overview

### Recommended Stack

| Layer | Choice | Justification |
|---|---|---|
| **Language** | TypeScript (Node.js) | Single language across services, large ecosystem, fast iteration |
| **Framework** | Fastify | Lower overhead than Express, built-in schema validation, great TypeScript support |
| **Database** | PostgreSQL (Supabase) | Relational integrity for user/fact relationships, Supabase gives managed Postgres + REST + real-time for free/low cost |
| **Background Jobs** | BullMQ + Redis | Reliable queue with retries, delay support, and job deduplication |
| **AI Provider** | OpenAI GPT-4o | Best quality/price for fact generation; structured JSON output mode |
| **Embeddings** | OpenAI text-embedding-3-small | Cheap, fast, good enough for dedup cosine similarity |
| **Vector Storage** | pgvector (Postgres extension) | Avoids a separate vector DB; embeddings live next to facts |
| **Hosting** | Railway (API + Redis) + Supabase (DB) | Low ops overhead for indie/small team; cheap at low scale, easy to migrate |
| **CDN / Storage** | Not needed at launch | No media assets initially |

### Why This Stack for a Small/Indie Team

- **One language end-to-end** means no context switching between Python workers and JS servers.
- **Supabase** provides a managed Postgres instance with a generous free tier, built-in connection pooling (pgBouncer), and a dashboard for inspecting data without writing SQL.
- **Railway** deploys directly from a GitHub repo with zero Kubernetes configuration. A single `railway up` ships the API and the BullMQ worker as two services.
- **pgvector** keeps the architecture simple. You don't need Pinecone or Weaviate to do cosine similarity on tens of thousands of facts.
- **BullMQ + Redis** is battle-tested for background job processing, handles retries and deduplication, and integrates cleanly with Fastify.

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          iOS App                                 │
│  UserDefaults (cached facts)   Keychain (device_id UUID)        │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTPS REST
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Railway — API Service                         │
│              Fastify + TypeScript (Node 20)                      │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Device Auth │  │ Facts Router │  │ Recommendations Router │  │
│  │ Middleware  │  │              │  │                        │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              BullMQ Job Enqueuer                         │   │
│  └──────────────────────────┬─────────────────────────────-┘   │
└──────────────────────────── │ ──────────────────────────────────┘
                              │ Redis Queue
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Railway — Worker Service                        │
│           BullMQ Worker (same codebase, different entry)        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  fact-generation queue                                   │   │
│  │    → call OpenAI GPT-4o                                  │   │
│  │    → generate embeddings (text-embedding-3-small)        │   │
│  │    → dedup via pgvector cosine similarity                │   │
│  │    → insert new facts to DB                              │   │
│  │    → update generation job status                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────── │ ──────────────────────────────────┘
                              │ SQL
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase (PostgreSQL)                         │
│                      + pgvector extension                        │
│                                                                  │
│  devices  topics  facts  user_topics  user_fact_history          │
│  user_favorites  fact_generation_jobs                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    OpenAI API (GPT-4o + Embeddings)
```

---

## 2. Anonymous Identity System

### Device ID Generation (iOS Side)

The app generates a UUID on first launch and stores it permanently in the iOS Keychain (not UserDefaults — Keychain survives app deletion/reinstall on the same device).

```swift
// KeychainHelper.swift
func getOrCreateDeviceId() -> String {
    let key = "com.intellectual.device_id"
    if let existing = KeychainHelper.read(key: key) {
        return existing
    }
    let newId = UUID().uuidString
    KeychainHelper.write(key: key, value: newId)
    return newId
}
```

### How It Works Server-Side

1. Every API request includes the header `X-Device-ID: <uuid>`.
2. The Fastify middleware checks if this `device_id` exists in the `devices` table.
3. If it does not exist, a new device row is created automatically (upsert on first call).
4. No passwords, tokens, or sessions. The device UUID **is** the identity.

### Security Considerations

- The UUID is 122 bits of entropy. It is not guessable.
- The server does not expose other users' data; all queries are scoped to `device_id`.
- There is no way to "take over" another user's account without knowing their UUID (which lives only in their Keychain).
- For rate limiting, apply IP-based limiting at the reverse proxy layer (Railway supports this) to prevent abuse of the upsert-on-first-call behavior.

### Future: iCloud Sync Path

When/if you want cross-device sync:

1. Add an optional `icloud_record_id` column to `devices`.
2. On iOS, write the `device_id` to iCloud Key-Value Store (`NSUbiquitousKeyValueStore`).
3. On a new device, check iCloud first before generating a fresh UUID.
4. If a matching `icloud_record_id` already exists in the DB, merge the new `device_id` into that account (or simply return the existing device's data).
5. This requires no login screen and is transparent to the user.

---

## 3. Database Schema

### Enable pgvector

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

---

### Table: `devices`

Represents a single anonymous user (one per device).

```sql
CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       TEXT NOT NULL UNIQUE,         -- iOS-generated UUID from Keychain
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    timezone        TEXT NOT NULL DEFAULT 'UTC',  -- IANA tz string, e.g. 'America/New_York'
    streak_count    INTEGER NOT NULL DEFAULT 0,
    streak_last_date DATE,                        -- date of last streak-qualifying session
    total_facts_read INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_devices_device_id ON devices(device_id);
```

---

### Table: `topics`

A topic is either a preset (e.g. "History") or a custom topic created by a user.

```sql
CREATE TABLE topics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,          -- e.g. 'history', 'ww2-tanks'
    display_name    TEXT NOT NULL,                 -- e.g. 'WW2 Tanks'
    description     TEXT,
    is_preset       BOOLEAN NOT NULL DEFAULT FALSE,-- TRUE = curated, FALSE = AI-generated
    category        TEXT NOT NULL,                 -- taxonomy category (see Section 7)
    tags            TEXT[] NOT NULL DEFAULT '{}',  -- e.g. '{military, history, vehicles}'
    fact_count      INTEGER NOT NULL DEFAULT 0,    -- denormalized count, updated on insert
    created_by      UUID REFERENCES devices(id),   -- NULL for preset topics
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_topics_slug ON topics(slug);
CREATE INDEX idx_topics_category ON topics(category);
CREATE INDEX idx_topics_tags ON topics USING GIN(tags);
CREATE INDEX idx_topics_is_preset ON topics(is_preset);
```

---

### Table: `facts`

A single fact belonging to a topic.

```sql
CREATE TABLE facts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id        UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,                 -- full fact text
    lines           TEXT[] NOT NULL,               -- beat-by-beat split, e.g. 3 elements
    source_hint     TEXT,                          -- optional attribution/source note
    embedding       vector(1536),                  -- OpenAI text-embedding-3-small output
    quality_score   FLOAT DEFAULT NULL,            -- optional future GPT quality rating
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generation_job_id UUID,                        -- which job produced this fact (nullable for preset)
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_facts_topic_id ON facts(topic_id);
CREATE INDEX idx_facts_topic_active ON facts(topic_id) WHERE is_active = TRUE;
-- pgvector IVFFlat index for fast approximate nearest neighbor search (dedup)
CREATE INDEX idx_facts_embedding ON facts USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

**Note on `lines` column:** The AI is prompted to return facts as an array of 2–3 short lines. These map directly to the beat-by-beat reveal in the iOS app. Example:

```json
["the human brain contains roughly 86 billion neurons.",
 "yet you only actively use a small fraction at any given moment.",
 "the rest are standing by — ready to fire when needed."]
```

---

### Table: `user_topics`

Which topics a device follows, and metadata about their progress on each topic.

```sql
CREATE TABLE user_topics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id           UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    topic_id            UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    followed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_fact_served_at TIMESTAMPTZ,               -- used for feed ordering
    unseen_fact_count   INTEGER NOT NULL DEFAULT 0,-- denormalized, decremented on serve
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(device_id, topic_id)
);

CREATE INDEX idx_user_topics_device ON user_topics(device_id);
CREATE INDEX idx_user_topics_device_active ON user_topics(device_id) WHERE is_active = TRUE;
```

---

### Table: `user_fact_history`

Every fact a user has ever been served. This is the source of truth for the no-repeat guarantee.

```sql
CREATE TABLE user_fact_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    fact_id     UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    topic_id    UUID NOT NULL REFERENCES topics(id),  -- denormalized for fast topic queries
    seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_fully  BOOLEAN NOT NULL DEFAULT FALSE,        -- TRUE if user read all beats
    UNIQUE(device_id, fact_id)
);

CREATE INDEX idx_history_device ON user_fact_history(device_id);
CREATE INDEX idx_history_device_topic ON user_fact_history(device_id, topic_id);
CREATE INDEX idx_history_seen_at ON user_fact_history(device_id, seen_at DESC);
```

---

### Table: `user_favorites`

Facts a user has starred.

```sql
CREATE TABLE user_favorites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    fact_id     UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
    favorited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(device_id, fact_id)
);

CREATE INDEX idx_favorites_device ON user_favorites(device_id);
CREATE INDEX idx_favorites_device_time ON user_favorites(device_id, favorited_at DESC);
```

---

### Table: `fact_generation_jobs`

Tracks background AI generation runs. Used for deduplication of concurrent triggers and for observability.

```sql
CREATE TABLE fact_generation_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id        UUID NOT NULL REFERENCES topics(id),
    triggered_by    TEXT NOT NULL,           -- 'low_stock' | 'new_topic' | 'manual'
    status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'done' | 'failed'
    facts_requested INTEGER NOT NULL DEFAULT 10,
    facts_created   INTEGER NOT NULL DEFAULT 0,
    facts_rejected  INTEGER NOT NULL DEFAULT 0,  -- rejected due to dedup
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_topic_status ON fact_generation_jobs(topic_id, status);
CREATE INDEX idx_jobs_created ON fact_generation_jobs(created_at DESC);
```

---

## 4. API Endpoints

### Authentication

Every request must include:

```
X-Device-ID: <uuid>
Content-Type: application/json
```

The server middleware validates the header is a valid UUID format. If missing or malformed, it returns `400 Bad Request`.

---

### Group: Device

#### `POST /v1/device/register`

Called on first app launch. Upserts the device record.

**Request Body:**
```json
{
  "device_id": "A3F2B1C4-1234-5678-ABCD-EF0123456789",
  "timezone": "America/New_York",
  "platform": "ios",
  "app_version": "1.0.0"
}
```

**Response `200 OK`:**
```json
{
  "device_id": "A3F2B1C4-1234-5678-ABCD-EF0123456789",
  "is_new": true,
  "streak_count": 0,
  "total_facts_read": 0,
  "created_at": "2026-03-08T09:00:00Z"
}
```

---

#### `PATCH /v1/device`

Update device metadata (e.g. timezone after DST change).

**Request Body:**
```json
{
  "timezone": "America/Los_Angeles"
}
```

**Response `200 OK`:**
```json
{
  "updated": true
}
```

---

### Group: Topics

#### `GET /v1/topics/preset`

Returns all preset topics, optionally filtered by category.

**Query Params:** `?category=science`

**Response `200 OK`:**
```json
{
  "topics": [
    {
      "id": "uuid",
      "slug": "history",
      "display_name": "History",
      "description": "Major events and turning points in human history.",
      "category": "humanities",
      "tags": ["history", "culture", "events"],
      "fact_count": 247,
      "is_following": false
    }
  ]
}
```

---

#### `POST /v1/topics/custom`

Create a new custom topic. Triggers background AI generation.

**Request Body:**
```json
{
  "display_name": "WW2 Tanks",
  "description": "The armored vehicles that shaped World War II."
}
```

**Response `201 Created`:**
```json
{
  "id": "uuid",
  "slug": "ww2-tanks",
  "display_name": "WW2 Tanks",
  "category": "history",
  "tags": ["military", "history", "vehicles"],
  "generation_job_id": "uuid",
  "status": "generating",
  "estimated_ready_seconds": 30
}
```

The server:
1. Creates the topic row.
2. Infers category/tags using a simple keyword classifier (or a single cheap GPT-4o-mini call).
3. Enqueues a `fact-generation` BullMQ job.
4. Returns immediately; the iOS app polls or uses the status endpoint.

---

#### `GET /v1/topics/custom/:topic_id/status`

Poll for generation status of a new custom topic.

**Response `200 OK`:**
```json
{
  "topic_id": "uuid",
  "status": "done",
  "fact_count": 10,
  "generation_job_id": "uuid"
}
```

Status values: `generating` | `done` | `failed`

---

#### `POST /v1/topics/:topic_id/follow`

Follow a topic.

**Response `200 OK`:**
```json
{
  "topic_id": "uuid",
  "followed": true,
  "unseen_fact_count": 10
}
```

---

#### `DELETE /v1/topics/:topic_id/follow`

Unfollow a topic. History and favorites are preserved.

**Response `200 OK`:**
```json
{
  "topic_id": "uuid",
  "followed": false
}
```

---

#### `GET /v1/topics/following`

Get all topics the device follows, with progress metadata.

**Response `200 OK`:**
```json
{
  "topics": [
    {
      "id": "uuid",
      "slug": "ww2-tanks",
      "display_name": "WW2 Tanks",
      "category": "history",
      "tags": ["military", "history", "vehicles"],
      "is_preset": false,
      "fact_count": 47,
      "unseen_fact_count": 12,
      "last_fact_served_at": "2026-03-07T20:14:00Z"
    }
  ]
}
```

---

### Group: Facts

#### `GET /v1/facts/feed`

The main endpoint. Returns the next batch of unseen facts for the device's daily feed. This is the most performance-critical endpoint.

**Query Params:**
- `limit` (default: 10, max: 20)
- `topic_id` (optional — if provided, return facts only for this topic)
- `mode` (optional: `"random"` shuffles topics uniformly)

**Response `200 OK`:**
```json
{
  "facts": [
    {
      "id": "uuid",
      "topic_id": "uuid",
      "topic_slug": "ww2-tanks",
      "topic_display_name": "WW2 Tanks",
      "lines": [
        "the tiger i tank was feared across every front it appeared on.",
        "but it was so expensive to build that germany produced fewer than 1,350 total.",
        "the soviet t-34 outnumbered it roughly 10 to 1 by the war's end."
      ],
      "is_favorited": false
    }
  ],
  "prefetch_triggered": ["uuid-of-topic-that-triggered-generation"],
  "has_more": true
}
```

The `prefetch_triggered` field tells the iOS app that background generation is running for those topics, so it can show a loading indicator if needed.

---

#### `GET /v1/facts/topic/:topic_id`

Get unseen facts for a single topic (used when user taps into a specific topic).

**Query Params:** `?limit=10&offset=0`

**Response:** Same shape as `/feed` but scoped to one topic.

---

#### `POST /v1/facts/:fact_id/seen`

Mark a fact as seen. Called as the user reads each fact (not just when they finish).

**Request Body:**
```json
{
  "read_fully": true
}
```

**Response `200 OK`:**
```json
{
  "fact_id": "uuid",
  "recorded": true,
  "total_facts_read": 142
}
```

---

#### `POST /v1/facts/:fact_id/favorite`

Toggle favorite on a fact.

**Response `200 OK`:**
```json
{
  "fact_id": "uuid",
  "is_favorited": true
}
```

---

#### `GET /v1/facts/favorites`

Get all favorited facts, newest first.

**Query Params:** `?limit=20&offset=0`

**Response `200 OK`:**
```json
{
  "favorites": [
    {
      "id": "uuid",
      "topic_display_name": "Psychology",
      "lines": ["..."],
      "favorited_at": "2026-03-07T18:30:00Z"
    }
  ],
  "total": 34
}
```

---

#### `GET /v1/facts/history`

Full fact history for the device, newest first.

**Query Params:** `?limit=20&offset=0&topic_id=<uuid>`

**Response `200 OK`:**
```json
{
  "history": [
    {
      "id": "uuid",
      "topic_display_name": "History",
      "lines": ["..."],
      "seen_at": "2026-03-08T08:45:00Z",
      "read_fully": true,
      "is_favorited": false
    }
  ],
  "total": 312
}
```

---

### Group: Progress

#### `GET /v1/progress`

Full progress summary for the device. Used for the iOS progress/stats screen.

**Response `200 OK`:**
```json
{
  "streak_count": 7,
  "streak_last_date": "2026-03-08",
  "total_facts_read": 312,
  "total_favorites": 34,
  "topics_following": 6,
  "facts_by_topic": [
    {
      "topic_id": "uuid",
      "display_name": "Psychology",
      "facts_read": 89,
      "facts_favorited": 12
    }
  ],
  "recent_activity": [
    { "date": "2026-03-08", "facts_read": 12 },
    { "date": "2026-03-07", "facts_read": 8 },
    { "date": "2026-03-06", "facts_read": 0 }
  ]
}
```

---

#### `POST /v1/progress/session`

Called when the user finishes a reading session. Updates streak logic server-side.

**Request Body:**
```json
{
  "facts_read_count": 5,
  "session_date": "2026-03-08",
  "timezone": "America/New_York"
}
```

**Response `200 OK`:**
```json
{
  "streak_count": 8,
  "streak_extended": true,
  "total_facts_read": 317
}
```

---

### Group: Recommendations

#### `GET /v1/topics/recommended`

Returns up to 10 recommended topics the device is not currently following.

**Response `200 OK`:**
```json
{
  "recommendations": [
    {
      "id": "uuid",
      "slug": "swift-programming",
      "display_name": "Swift Programming",
      "category": "technology",
      "tags": ["programming", "ios", "apple"],
      "reason": "Because you follow iOS Development",
      "fact_count": 95,
      "is_preset": true
    }
  ]
}
```

---

## 5. AI Fact Generation Pipeline

### Trigger Conditions

A fact generation job is triggered when **either** condition is true:

1. **New custom topic created** — immediately after the topic row is inserted.
2. **Low stock** — when `user_topics.unseen_fact_count` drops below **3** for any topic a device follows.

The low-stock check happens inside `GET /v1/facts/feed`. After computing the feed, the server inspects `unseen_fact_count` for each topic. If any topic is below the threshold, a BullMQ job is enqueued. A job deduplication key of `fact-gen:{topic_id}` prevents multiple concurrent jobs for the same topic.

```typescript
// Dedup key prevents double-enqueueing
await factGenerationQueue.add(
  'generate',
  { topic_id: topicId, triggered_by: 'low_stock' },
  {
    jobId: `fact-gen:${topicId}`,  // BullMQ dedup by jobId
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 }
  }
);
```

---

### Prompt Template

The worker builds the following prompt. It uses GPT-4o with `response_format: { type: "json_object" }`.

```typescript
function buildFactPrompt(
  topicName: string,
  existingFacts: string[],   // last 20 facts already in DB for this topic (for variety)
  batchSize: number = 10
): string {
  const existingList = existingFacts.length > 0
    ? `\n\nAvoid repeating these facts that already exist:\n${existingFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    : '';

  return `You are a writer for "Intellectual", a daily fact app. Your job is to write fascinating, accurate, surprising facts.

Topic: ${topicName}

Rules:
- Write exactly ${batchSize} facts
- Each fact is split into exactly 2 or 3 short lines (this is for a beat-by-beat reveal UI)
- All text is lowercase and conversational — never formal or encyclopedia-style
- Each line is 1 sentence maximum, ideally under 15 words
- Facts must be surprising, counter-intuitive, or genuinely interesting — not generic
- No bullet points, no headers, no numbering in the lines themselves
- Do not repeat the topic name in every fact — vary your openings
- Prioritize facts a curious person would share with a friend over dinner${existingList}

Return a JSON object with this exact shape:
{
  "facts": [
    {
      "lines": ["line one.", "line two.", "optional line three."],
      "source_hint": "optional: short attribution like 'NASA, 2023' or null"
    }
  ]
}`;
}
```

**Example output for topic "WW2 Tanks":**

```json
{
  "facts": [
    {
      "lines": [
        "the tiger i was so heavy it could crush bridges not designed for it.",
        "german engineers had to plan special routes just to move it across europe.",
        "entire supply chains were restructured around one tank's weight."
      ],
      "source_hint": "US Army Ordnance reports, 1944"
    }
  ]
}
```

---

### Semantic Deduplication Strategy

Before inserting any generated fact, the worker checks it against existing facts for that topic using embedding cosine similarity.

```typescript
async function isDuplicate(
  newFactText: string,
  topicId: string,
  threshold: number = 0.92
): Promise<boolean> {
  // 1. Generate embedding for the new fact
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: newFactText,
  });
  const newEmbedding = embeddingResponse.data[0].embedding;

  // 2. Query pgvector for nearest neighbors in the same topic
  const result = await db.query(`
    SELECT 1 - (embedding <=> $1::vector) AS similarity
    FROM facts
    WHERE topic_id = $2
      AND is_active = TRUE
    ORDER BY embedding <=> $1::vector
    LIMIT 1
  `, [JSON.stringify(newEmbedding), topicId]);

  if (result.rows.length === 0) return false;
  return result.rows[0].similarity >= threshold;
}
```

**Threshold of 0.92:** Facts scoring >= 0.92 cosine similarity are considered duplicates and discarded. This catches paraphrases and near-identical rewrites while allowing genuinely different facts on the same subject.

---

### Worker Flow (Full)

```
BullMQ picks up job { topic_id, triggered_by }
  │
  ├─ 1. Set job status = 'running' in fact_generation_jobs
  ├─ 2. Fetch topic row (name, tags, existing fact count)
  ├─ 3. Fetch last 20 fact content strings for this topic (for variety hints)
  ├─ 4. Call GPT-4o with buildFactPrompt(...)
  ├─ 5. Parse JSON response → array of { lines, source_hint }
  ├─ 6. For each fact:
  │     ├─ Concatenate lines into full content string
  │     ├─ Generate embedding via text-embedding-3-small
  │     ├─ Check isDuplicate() against pgvector
  │     ├─ If duplicate → increment facts_rejected, skip
  │     └─ If unique → INSERT into facts table with embedding
  ├─ 7. UPDATE topics SET fact_count = fact_count + facts_created
  ├─ 8. UPDATE user_topics SET unseen_fact_count = unseen_fact_count + facts_created
  │      WHERE topic_id = $1 (for all followers of this topic)
  └─ 9. Set job status = 'done', set completed_at
```

If GPT-4o call fails or returns malformed JSON, BullMQ retries up to 3 times with exponential backoff. After 3 failures, status is set to `'failed'` and an alert can be sent via a simple webhook.

---

## 6. No-Repeat Algorithm

### Tracking

Every fact served is recorded in `user_fact_history` with a `UNIQUE(device_id, fact_id)` constraint. This is the hard guarantee: a fact can only appear in this table once per device.

### Query Pattern

When fetching facts for a device, always use a `LEFT JOIN / IS NULL` anti-join pattern:

```sql
-- Fetch N unseen facts for a specific topic for a device
SELECT f.id, f.topic_id, f.lines, f.content
FROM facts f
LEFT JOIN user_fact_history h
    ON h.fact_id = f.id AND h.device_id = $1
WHERE f.topic_id = $2
  AND f.is_active = TRUE
  AND h.fact_id IS NULL          -- has NOT been seen
ORDER BY f.created_at ASC        -- serve oldest first (consistent ordering)
LIMIT $3;
```

This query is fast because:
- `idx_facts_topic_active` covers the `topic_id + is_active` filter.
- `idx_history_device_topic` covers the join on `(device_id, topic_id)`.

### Exhaustion Fallback

When the anti-join returns 0 rows, all facts for this topic have been seen. The server handles this in two ways:

1. **Trigger regeneration** — enqueue a new `fact-generation` job for the topic (same as low-stock trigger). This generates 10 more fresh facts.
2. **Notify the iOS app** — the `/feed` response includes a `"exhausted_topics": ["uuid"]` field. The app shows a message like "You've read everything on WW2 Tanks — new facts are being generated."

```json
{
  "facts": [...],
  "exhausted_topics": ["uuid-of-ww2-tanks-topic"],
  "prefetch_triggered": ["uuid-of-ww2-tanks-topic"]
}
```

If regeneration is already in progress (a pending/running job exists for this topic), the server does not enqueue a duplicate — the BullMQ `jobId` deduplication handles this.

---

## 7. Recommendation Engine

### Topic Taxonomy

Define a fixed set of categories. Each topic has exactly one category and a set of free-form tags.

| Category | Example Topics |
|---|---|
| `history` | History, WW2 Tanks, Ancient Rome, Cold War, Medieval Europe |
| `science` | Science, Quantum Physics, Astronomy, Marine Biology, Genetics |
| `technology` | iOS Development, Artificial Intelligence, Cybersecurity, Computer History |
| `psychology` | Psychology, Behavioral Economics, Cognitive Biases, Sleep Science |
| `humanities` | Philosophy, Linguistics, Mythology, Classical Literature |
| `health` | Nutrition, Exercise Science, Neuroscience, Medicine |
| `culture` | Architecture, Film History, Music Theory, Art History |
| `nature` | Ecology, Animal Kingdom, Geology, Meteorology |
| `economics` | Economics, Investing Basics, Geopolitics, Entrepreneurship |
| `mathematics` | Mathematics, Statistics, Cryptography, Game Theory |

---

### Recommendation Query Logic

Two signals combined into one query:

**Signal 1: Same-category topics** — If a user follows "WW2 Tanks" (category: history), recommend other history topics they don't follow.

**Signal 2: Tag overlap** — Topics sharing tags with followed topics score higher.

```sql
WITH followed AS (
    SELECT t.id, t.category, t.tags
    FROM user_topics ut
    JOIN topics t ON t.id = ut.topic_id
    WHERE ut.device_id = $1 AND ut.is_active = TRUE
),
followed_tags AS (
    SELECT UNNEST(tags) AS tag FROM followed
),
candidate_topics AS (
    SELECT
        t.id,
        t.slug,
        t.display_name,
        t.category,
        t.tags,
        t.fact_count,
        t.is_preset,
        -- Score: +3 for same category, +1 for each shared tag
        (CASE WHEN t.category IN (SELECT category FROM followed) THEN 3 ELSE 0 END
         + (SELECT COUNT(*) FROM followed_tags ft WHERE ft.tag = ANY(t.tags))
        ) AS relevance_score
    FROM topics t
    WHERE t.is_active = TRUE
      AND t.id NOT IN (SELECT topic_id FROM followed)
      AND t.fact_count >= 10   -- only suggest topics with enough content
)
SELECT *
FROM candidate_topics
WHERE relevance_score > 0
ORDER BY relevance_score DESC, fact_count DESC
LIMIT 10;
```

**Reason string generation:** The API constructs the `reason` field from the highest-matching followed topic:

```typescript
function buildReasonString(
  recommendation: Topic,
  followedTopics: Topic[]
): string {
  const match = followedTopics.find(
    t => t.category === recommendation.category
  );
  if (match) return `Because you follow ${match.display_name}`;
  return `Popular in ${recommendation.category}`;
}
```

---

### Collaborative Signal (Co-occurrence)

Once enough data exists (Phase 2), add a co-follow query. "Devices who follow topic A also follow topic B" can be computed with a simple join:

```sql
-- Topics co-followed with a given topic_id, by popularity
SELECT
    ut2.topic_id AS recommended_topic_id,
    COUNT(DISTINCT ut2.device_id) AS co_follow_count
FROM user_topics ut1
JOIN user_topics ut2
    ON ut1.device_id = ut2.device_id
    AND ut2.topic_id != ut1.topic_id
    AND ut2.is_active = TRUE
WHERE ut1.topic_id = $1   -- the topic user already follows
  AND ut1.is_active = TRUE
GROUP BY ut2.topic_id
ORDER BY co_follow_count DESC
LIMIT 5;
```

This requires no ML — just a GROUP BY. Run it nightly and cache results in a `topic_cofollow_cache` table to avoid running it on every request.

---

## 8. "For You" Feed Logic

### Mix Ratio

The `/v1/facts/feed` endpoint builds a blended feed from all topics the user follows. The default `limit` is 10 facts.

**Allocation algorithm:**

1. Fetch all active `user_topics` for the device, ordered by `last_fact_served_at ASC NULLS FIRST` (least recently served topic gets priority).
2. Distribute `limit` facts across topics using a round-robin weighted by recency:
   - Topics never served yet get 3 slots.
   - Topics served more than 24 hours ago get 2 slots.
   - Topics served within the last 24 hours get 1 slot.
3. Cap any single topic at 5 facts per feed call to prevent monotony.
4. If a topic has fewer unseen facts than its allocated slots, take what's available and redistribute remaining slots to the next topic in priority order.

```typescript
function allocateSlots(userTopics: UserTopic[], limit: number): Map<string, number> {
  const now = Date.now();
  const allocations = new Map<string, number>();
  let remaining = limit;

  // Sort: never served first, then longest ago
  const sorted = [...userTopics].sort((a, b) => {
    const aTime = a.last_fact_served_at ? new Date(a.last_fact_served_at).getTime() : 0;
    const bTime = b.last_fact_served_at ? new Date(b.last_fact_served_at).getTime() : 0;
    return aTime - bTime;
  });

  for (const topic of sorted) {
    if (remaining <= 0) break;
    const lastServed = topic.last_fact_served_at
      ? now - new Date(topic.last_fact_served_at).getTime()
      : Infinity;
    let slots = lastServed > 24 * 3600 * 1000 ? 2 : 1;
    if (!topic.last_fact_served_at) slots = 3;
    slots = Math.min(slots, 5, remaining, topic.unseen_fact_count);
    if (slots > 0) {
      allocations.set(topic.topic_id, slots);
      remaining -= slots;
    }
  }

  return allocations;
}
```

### Ordering Within the Feed

Facts from different topics are interleaved rather than grouped, to prevent the feed feeling like "all history, then all science." After allocation, the feed is assembled by round-robin across the allocated topics.

### Random Mode

When the client passes `?mode=random`:

- Skip the recency-weighted ordering.
- Pick topics uniformly at random from the user's followed list.
- Use `ORDER BY RANDOM()` in the SQL query (acceptable at this data scale; switch to a keyset approach if performance degrades).
- Useful for users who want to be surprised rather than catch up systematically.

---

## 9. Streak & Progress Tracking

### What the Server Tracks

| Field | Location | Description |
|---|---|---|
| `streak_count` | `devices.streak_count` | Current consecutive-day streak |
| `streak_last_date` | `devices.streak_last_date` | The most recent date (in user's timezone) they qualified |
| `total_facts_read` | `devices.total_facts_read` | Lifetime total, incremented on `POST /facts/:id/seen` |
| `read_fully` | `user_fact_history.read_fully` | Whether user read all beats of a fact |

### Streak Qualification

A day qualifies for a streak if the user reads **at least 1 fact** with `read_fully = TRUE` on that calendar date in their local timezone.

### Timezone Handling

The device sends its IANA timezone string (e.g. `"America/New_York"`) on registration and on `POST /progress/session`. The server stores this in `devices.timezone`.

Streak date calculation:

```typescript
import { toZonedTime, format } from 'date-fns-tz';

function getLocalDate(timezone: string): string {
  const zonedDate = toZonedTime(new Date(), timezone);
  return format(zonedDate, 'yyyy-MM-dd', { timeZone: timezone });
}
```

Streak update logic in `POST /v1/progress/session`:

```typescript
async function updateStreak(deviceId: string, sessionDate: string): Promise<number> {
  const device = await getDevice(deviceId);
  const lastDate = device.streak_last_date;  // 'YYYY-MM-DD' string or null

  if (lastDate === sessionDate) {
    // Already credited today — no change
    return device.streak_count;
  }

  const yesterday = format(subDays(parseISO(sessionDate), 1), 'yyyy-MM-dd');

  let newStreak: number;
  if (lastDate === yesterday) {
    // Consecutive day — extend streak
    newStreak = device.streak_count + 1;
  } else {
    // Gap in streak — reset to 1
    newStreak = 1;
  }

  await db.query(
    `UPDATE devices SET streak_count = $1, streak_last_date = $2 WHERE id = $3`,
    [newStreak, sessionDate, deviceId]
  );

  return newStreak;
}
```

**No grace periods at MVP.** Adding a 24-hour grace window (for users in edge timezones or who read at 11:59pm) can be added in Phase 2 if users report frustration.

---

## 10. iOS Integration Notes

### What to Store Where

| Data | Storage | Reason |
|---|---|---|
| `device_id` | Keychain | Survives app delete/reinstall |
| Cached facts (offline buffer) | UserDefaults or CoreData | Quick access, no Keychain overhead |
| Current streak (display only) | UserDefaults (write-through) | Instant display on app open |
| User's followed topics list | UserDefaults (write-through) | Fast topic picker rendering |
| Favorites list | Server only | Single source of truth |
| Full fact history | Server only | Too large for device |
| API base URL | Build config (not plist) | Easy to change per environment |

---

### Offline Support Strategy

The app should cache **20 facts per followed topic** locally for offline reading. This is a rolling buffer.

**Prefetch behavior:**
1. On app foreground, call `GET /v1/facts/feed?limit=20`.
2. Store returned facts in CoreData (or a simple `[FactDTO]` JSON blob in UserDefaults for MVP).
3. Track which cached facts have been "consumed" locally.
4. When local cache drops below 5 facts for any topic, trigger a background fetch.
5. When offline, serve from local cache. Mark facts as `"pending_sync": true`.
6. On next network connection, batch-POST pending seen/favorite events.

**Batch sync endpoint** (handle offline marking):

```
POST /v1/sync/events
```

```json
{
  "events": [
    { "type": "seen", "fact_id": "uuid", "read_fully": true, "occurred_at": "2026-03-08T07:00:00Z" },
    { "type": "favorite", "fact_id": "uuid", "occurred_at": "2026-03-08T07:01:00Z" }
  ]
}
```

---

### API Key Security

**Never bundle API keys in the app.** The OpenAI key lives only on the server. The iOS app communicates only with your backend URL. There are no direct calls from the app to OpenAI.

For the backend URL itself:
- Use a build-time environment variable (`API_BASE_URL`) set via Xcode's build scheme.
- Different values for Debug (`https://api-staging.intellectual.app`) and Release (`https://api.intellectual.app`).
- Use Certificate Pinning in production once you have a stable TLS certificate.

```swift
// NetworkClient.swift
private let baseURL: URL = {
    guard let urlString = Bundle.main.infoDictionary?["API_BASE_URL"] as? String,
          let url = URL(string: urlString) else {
        fatalError("API_BASE_URL not configured in Info.plist")
    }
    return url
}()
```

---

## 11. Phased Rollout

### Phase 1 — MVP (Weeks 1–6)

**Goal:** Working app, real facts, no bloat.

- [ ] Fastify API with device registration, topic follow/unfollow, feed endpoint
- [ ] PostgreSQL schema deployed on Supabase
- [ ] 10 preset topics with 100+ pre-written facts each (no AI yet — write them manually or with a one-time script)
- [ ] `POST /facts/:id/seen` and `POST /facts/:id/favorite`
- [ ] Basic streak tracking (no grace period)
- [ ] `GET /progress` endpoint
- [ ] `GET /facts/history` and `GET /facts/favorites`
- [ ] No-repeat algorithm (anti-join query)
- [ ] Railway deployment (single API service, no workers yet)
- [ ] iOS app reads from real API, `device_id` in Keychain

**What to defer:** AI generation, recommendations, offline sync, custom topics.

---

### Phase 2 — AI Generation & Recommendations (Weeks 7–12)

**Goal:** Custom topics, smarter recommendations, offline reliability.

- [ ] BullMQ + Redis worker service on Railway
- [ ] AI fact generation pipeline (GPT-4o + deduplication with pgvector)
- [ ] `POST /v1/topics/custom` endpoint
- [ ] Proactive prefetch trigger (low-stock check in feed endpoint)
- [ ] Recommendation engine (tag/category-based SQL query)
- [ ] `GET /v1/topics/recommended` endpoint
- [ ] Offline cache in iOS (20 facts per topic, batch sync)
- [ ] Topic status polling (`GET /topics/:id/status`)
- [ ] Admin dashboard (Supabase Studio is enough for now)
- [ ] Basic error alerting (webhook to Slack on worker failures)

---

### Phase 3 — Social & Growth (Weeks 13+)

**Goal:** Retention features, shareability, monetization hooks.

- [ ] **Fact sharing** — generate a shareable card image server-side (via `@vercel/og` or `satori`) for iOS share sheet
- [ ] **Leaderboards** — global or friends-based streak leaderboards (requires optional display name, no full account)
- [ ] **iCloud sync** — cross-device identity (see Section 2)
- [ ] **Collections** — user-curated lists of favorited facts
- [ ] **Weekly digest** — push notification with top 3 facts from followed topics (requires APNs integration)
- [ ] **Monetization** — custom topics gated behind a one-time purchase or subscription (StoreKit 2 on iOS, honor on backend via `devices.is_premium` flag)
- [ ] **Co-occurrence recommendations** — nightly materialized view of topic co-follows
- [ ] **Quality scoring** — GPT-4o rates each generated fact 1–5; surface top-rated facts first in exhausted-topic fallback
- [ ] **Analytics** — integrate PostHog or a simple events table to track funnel (app open → topic follow → fact read → favorite)

---

*End of document.*

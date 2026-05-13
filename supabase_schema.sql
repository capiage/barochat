-- Supabase Migration Schema for Le BaroChat
-- Run this in your Supabase SQL Editor

-- 1. Create Tables
CREATE TABLE users (
  uid text PRIMARY KEY,
  username text,
  "displayName" text,
  bio text,
  avatar text,
  banner text,
  "joinedServers" text[],
  friends text[],
  "lastRead" jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE servers (
  id text PRIMARY KEY,
  owner text,
  name text,
  icon text,
  "isPublic" boolean,
  channels jsonb,
  banner text,
  "bannerColor" text,
  bio text,
  "memberData" jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roomId" text,
  "senderId" text,
  text text,
  timestamp numeric,
  image text,
  edited boolean DEFAULT false
);

CREATE TABLE dms (
  id text PRIMARY KEY,
  participants text[]
);

CREATE TABLE accounts (
  "profileId" text PRIMARY KEY,
  username text UNIQUE,
  password text
);

CREATE TABLE signaling (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "to" text,
  "from" text,
  type text,
  room text,
  "callRoom" text,
  response text,
  signal text,
  timestamp numeric DEFAULT extract(epoch from now()) * 1000
);

CREATE TABLE presence (
  uid text PRIMARY KEY,
  status text,
  "currentVoice" text,
  "isScreenSharing" boolean,
  "isCameraOff" boolean,
  "isMuted" boolean,
  "lastActive" numeric
);

-- 2. Setup Realtime Sync
-- Enable real-time for all these tables
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE servers;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE dms;
ALTER PUBLICATION supabase_realtime ADD TABLE signaling;
ALTER PUBLICATION supabase_realtime ADD TABLE presence;

-- 3. Setup Storage
-- Create the "uploads" bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', true);

-- Enable public access to uploads
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING ( bucket_id = 'uploads' );
CREATE POLICY "Anon Insert" ON storage.objects FOR INSERT WITH CHECK ( bucket_id = 'uploads' );

-- 4. Bypass RLS (Row Level Security) for anonymous access
-- Since your app logic currently assumes full access to these collections
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE servers DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE signaling DISABLE ROW LEVEL SECURITY;
ALTER TABLE presence DISABLE ROW LEVEL SECURITY;

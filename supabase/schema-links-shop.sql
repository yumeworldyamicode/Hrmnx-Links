-- Hrmnx Links + Hrmnx Shop initial schema.
-- Run in the Supabase SQL Editor after reviewing the project. Do not disable RLS.
-- Public browser clients may read published links/releases and active products only.
-- Staff writes should be added only after mapping the existing Nemawashi staff/role
-- model to auth.uid(); never grant anonymous INSERT/UPDATE/DELETE access.

create extension if not exists pgcrypto;

create table if not exists public.links_artists (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  handle text,
  bio text,
  profile_image_url text,
  is_published boolean not null default false,
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.links_releases (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid references public.links_artists(id) on delete cascade,
  artist_slug text not null,
  slug text not null,
  parent_release_id uuid references public.links_releases(id) on delete set null,
  title text not null,
  subtitle text,
  release_type text,
  cover_image_url text,
  release_date date,
  is_published boolean not null default false,
  theme_overrides jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_slug, slug)
);

create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid references public.links_artists(id) on delete set null,
  release_id uuid references public.links_releases(id) on delete set null,
  sku text unique,
  slug text not null unique,
  name text not null,
  description text,
  product_type text not null default 'physical',
  price_amount numeric(12,2),
  currency text not null default 'EUR',
  image_url text,
  checkout_url text,
  stock_quantity integer,
  is_active boolean not null default false,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists links_releases_artist_slug_idx
  on public.links_releases (artist_slug, is_published, sort_order);
create index if not exists shop_products_release_active_idx
  on public.shop_products (release_id, is_active, sort_order);

alter table public.links_artists enable row level security;
alter table public.links_releases enable row level security;
alter table public.shop_products enable row level security;

drop policy if exists "Public can read published artists" on public.links_artists;
create policy "Public can read published artists"
  on public.links_artists for select to anon, authenticated
  using (is_published = true);

drop policy if exists "Public can read published releases" on public.links_releases;
create policy "Public can read published releases"
  on public.links_releases for select to anon, authenticated
  using (is_published = true);

drop policy if exists "Public can read active shop products" on public.shop_products;
create policy "Public can read active shop products"
  on public.shop_products for select to anon, authenticated
  using (is_active = true);

-- Intentionally no public write policies. Add staff-only policies after checking
-- the existing Nemawashi authorization tables and role names.
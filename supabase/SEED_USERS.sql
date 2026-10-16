-- ============================================================
-- THE HUNT — Fix Trigger + Seed Admin & Participant Users
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Fix the Signup Trigger (ensures search_path = public)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email))
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'participant')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 2. Create Admin and Participant Accounts
DO $$
DECLARE
  v_admin_id UUID := gen_random_uuid();
  v_player_id UUID := gen_random_uuid();
  v_event_id UUID;
  v_team_id UUID := gen_random_uuid();
  v_chal_id UUID := gen_random_uuid();
BEGIN

  -- ----------------------------------------------------
  -- A. ADMIN USER: admin@hunt.com / admin123
  -- ----------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@hunt.com') THEN
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_admin_id,
      'authenticated',
      'authenticated',
      'admin@hunt.com',
      crypt('admin123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"display_name":"Admin Commander"}',
      now(),
      now()
    );

    INSERT INTO public.profiles (id, display_name)
    VALUES (v_admin_id, 'Admin Commander')
    ON CONFLICT (id) DO UPDATE SET display_name = 'Admin Commander';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_admin_id, 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
  ELSE
    UPDATE public.user_roles
    SET role = 'admin'
    WHERE user_id = (SELECT id FROM auth.users WHERE email = 'admin@hunt.com');
  END IF;

  -- ----------------------------------------------------
  -- B. PARTICIPANT USER: player@hunt.com / player123
  -- ----------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'player@hunt.com') THEN
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      v_player_id,
      'authenticated',
      'authenticated',
      'player@hunt.com',
      crypt('player123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"display_name":"Agent Alpha"}',
      now(),
      now()
    );

    INSERT INTO public.profiles (id, display_name)
    VALUES (v_player_id, 'Agent Alpha')
    ON CONFLICT (id) DO UPDATE SET display_name = 'Agent Alpha';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_player_id, 'participant')
    ON CONFLICT (user_id) DO UPDATE SET role = 'participant';
  END IF;

  -- ----------------------------------------------------
  -- C. LIVE EVENT: THE HUNT 2026
  -- ----------------------------------------------------
  SELECT id INTO v_event_id FROM public.events WHERE status = 'live' LIMIT 1;
  IF v_event_id IS NULL THEN
    INSERT INTO public.events (name, description, status, starts_at, starting_coins)
    VALUES ('THE HUNT 2026', 'Official CSI NMAMIT Digital Treasure Hunt', 'live', now(), 100)
    RETURNING id INTO v_event_id;
  END IF;

  -- ----------------------------------------------------
  -- D. STARTER CHALLENGE + LEVELS (so you can test solving!)
  -- ----------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.challenges WHERE event_id = v_event_id) THEN
    INSERT INTO public.challenges (id, event_id, title, category, description, display_order, status)
    VALUES (v_chal_id, v_event_id, 'Operation Cipher Genesis', 'Crypto', 'Inaugural decryption trials for all hunter operatives.', 1, 'published');

    -- Level 1
    INSERT INTO public.challenge_levels (challenge_id, level_number, title, prompt, answer, answer_mode, points_reward, coins_reward, hint_text, hint_cost, status)
    VALUES (
      v_chal_id,
      1,
      'Level 1: The Caesar Breach',
      'Intercepted message: "WKH KXQW EHJLQV". Shifted by 3 letters backwards.',
      'THE HUNT BEGINS',
      'trimmed_case_insensitive',
      100,
      50,
      'Apply standard Caesar cipher shift -3 (D->A, E->B).',
      10,
      'published'
    );

    -- Level 2
    INSERT INTO public.challenge_levels (challenge_id, level_number, title, prompt, answer, answer_mode, points_reward, coins_reward, hint_text, hint_cost, status)
    VALUES (
      v_chal_id,
      2,
      'Level 2: Binary Genesis',
      'Convert to ASCII: 01000011 01010011 01001001',
      'CSI',
      'trimmed_case_insensitive',
      200,
      75,
      '8 bits per character. 01000011 = 67 in decimal.',
      15,
      'published'
    );
  END IF;

END $$;

-- ============================================================
-- DAILY BONUS - ROULETTE 50 SPICCHI
-- ============================================================
-- 1 giro al giorno per ogni utente
-- Base: 10.000 fiche
-- Timezone: Europe/Rome
-- 25x x1, 10x x2, 5x x5, 4x x10, 3x x15, 2x x30, 1x x100
-- Risultato deciso SERVER-SIDE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_bonus_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    base_amount BIGINT NOT NULL DEFAULT 10000 CHECK (base_amount > 0),
    timezone_name TEXT NOT NULL DEFAULT 'Europe/Rome',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.daily_bonus_settings (
    id, enabled, base_amount, timezone_name
)
VALUES (
    TRUE, TRUE, 10000, 'Europe/Rome'
)
ON CONFLICT (id)
DO UPDATE SET
    enabled = EXCLUDED.enabled,
    base_amount = EXCLUDED.base_amount,
    timezone_name = EXCLUDED.timezone_name,
    updated_at = NOW();


CREATE TABLE IF NOT EXISTS public.daily_bonus_segments (
    segment_index SMALLINT PRIMARY KEY
        CHECK (segment_index BETWEEN 0 AND 49),
    multiplier INTEGER NOT NULL
        CHECK (multiplier IN (1,2,5,10,15,30,100))
);

DELETE FROM public.daily_bonus_segments;

INSERT INTO public.daily_bonus_segments (
    segment_index,
    multiplier
)
VALUES
    (0, 100),
    (1, 1),
    (2, 2),
    (3, 10),
    (4, 1),
    (5, 1),
    (6, 2),
    (7, 5),
    (8, 1),
    (9, 1),
    (10, 15),
    (11, 2),
    (12, 1),
    (13, 5),
    (14, 1),
    (15, 1),
    (16, 2),
    (17, 30),
    (18, 1),
    (19, 1),
    (20, 10),
    (21, 2),
    (22, 1),
    (23, 5),
    (24, 1),
    (25, 1),
    (26, 2),
    (27, 15),
    (28, 1),
    (29, 1),
    (30, 5),
    (31, 2),
    (32, 1),
    (33, 30),
    (34, 1),
    (35, 1),
    (36, 2),
    (37, 10),
    (38, 1),
    (39, 1),
    (40, 5),
    (41, 2),
    (42, 1),
    (43, 15),
    (44, 1),
    (45, 1),
    (46, 2),
    (47, 10),
    (48, 1),
    (49, 1);


CREATE TABLE IF NOT EXISTS public.daily_bonus_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    bonus_date DATE NOT NULL,

    base_amount BIGINT NOT NULL
        CHECK (base_amount > 0),

    segment_index SMALLINT NOT NULL
        CHECK (segment_index BETWEEN 0 AND 49),

    multiplier INTEGER NOT NULL
        CHECK (multiplier IN (1,2,5,10,15,30,100)),

    win_amount BIGINT NOT NULL
        CHECK (win_amount > 0),

    balance_before BIGINT NOT NULL
        CHECK (balance_before >= 0),

    balance_after BIGINT NOT NULL
        CHECK (balance_after >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT daily_bonus_one_per_day
        UNIQUE (user_id, bonus_date)
);

CREATE INDEX IF NOT EXISTS daily_bonus_sessions_user_created_idx
ON public.daily_bonus_sessions (
    user_id,
    created_at DESC
);


ALTER TABLE public.daily_bonus_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_bonus_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_bonus_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.daily_bonus_settings FROM anon, authenticated;
REVOKE ALL ON public.daily_bonus_segments FROM anon, authenticated;
REVOKE ALL ON public.daily_bonus_sessions FROM anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_daily_bonus_state()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();

    v_enabled BOOLEAN;
    v_base_amount BIGINT;
    v_timezone TEXT;

    v_today DATE;
    v_next_available TIMESTAMPTZ;

    v_balance BIGINT;

    v_segments JSONB;
    v_segment_count INTEGER;

    v_session public.daily_bonus_sessions%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Utente non autenticato';
    END IF;

    SELECT
        s.enabled,
        s.base_amount,
        s.timezone_name
    INTO
        v_enabled,
        v_base_amount,
        v_timezone
    FROM public.daily_bonus_settings AS s
    WHERE s.id = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Configurazione Daily Bonus non trovata';
    END IF;

    v_today :=
        (
            timezone(
                v_timezone,
                CURRENT_TIMESTAMP
            )
        )::DATE;

    v_next_available :=
        timezone(
            v_timezone,
            (v_today + 1)::TIMESTAMP
        );

    SELECT p.chips
    INTO v_balance
    FROM public.profiles AS p
    WHERE p.user_id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profilo utente non trovato';
    END IF;

    SELECT
        jsonb_agg(
            d.multiplier
            ORDER BY d.segment_index
        ),
        COUNT(*)
    INTO
        v_segments,
        v_segment_count
    FROM public.daily_bonus_segments AS d;

    IF v_segment_count <> 50 THEN
        RAISE EXCEPTION
            'Configurazione Daily Bonus non valida: attesi 50 spicchi, trovati %',
            v_segment_count;
    END IF;

    SELECT db.*
    INTO v_session
    FROM public.daily_bonus_sessions AS db
    WHERE db.user_id = v_user_id
      AND db.bonus_date = v_today;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'enabled', v_enabled,
            'available', FALSE,
            'bonus_date', v_today,
            'base_amount', v_base_amount,
            'timezone', v_timezone,
            'segments', v_segments,
            'balance', v_balance,
            'next_available_at', v_next_available,
            'result', jsonb_build_object(
                'session_id', v_session.id,
                'segment_index', v_session.segment_index,
                'multiplier', v_session.multiplier,
                'win_amount', v_session.win_amount,
                'balance_before', v_session.balance_before,
                'balance_after', v_session.balance_after,
                'created_at', v_session.created_at
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'enabled', v_enabled,
        'available', v_enabled,
        'bonus_date', v_today,
        'base_amount', v_base_amount,
        'timezone', v_timezone,
        'segments', v_segments,
        'balance', v_balance,
        'next_available_at', NULL,
        'result', NULL
    );
END;
$$;


CREATE OR REPLACE FUNCTION public.spin_daily_bonus()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();

    v_enabled BOOLEAN;
    v_base_amount BIGINT;
    v_timezone TEXT;

    v_today DATE;
    v_next_available TIMESTAMPTZ;

    v_balance_before BIGINT;
    v_balance_after BIGINT;

    v_segment_count INTEGER;
    v_random_position INTEGER;

    v_segment_index SMALLINT;
    v_multiplier INTEGER;
    v_win_amount BIGINT;

    v_existing public.daily_bonus_sessions%ROWTYPE;
    v_session_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Utente non autenticato';
    END IF;

    SELECT
        s.enabled,
        s.base_amount,
        s.timezone_name
    INTO
        v_enabled,
        v_base_amount,
        v_timezone
    FROM public.daily_bonus_settings AS s
    WHERE s.id = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Configurazione Daily Bonus non trovata';
    END IF;

    IF NOT v_enabled THEN
        RAISE EXCEPTION 'Daily Bonus non disponibile';
    END IF;

    v_today :=
        (
            timezone(
                v_timezone,
                CURRENT_TIMESTAMP
            )
        )::DATE;

    v_next_available :=
        timezone(
            v_timezone,
            (v_today + 1)::TIMESTAMP
        );

    -- Serializza richieste contemporanee dello stesso utente.
    SELECT p.chips
    INTO v_balance_before
    FROM public.profiles AS p
    WHERE p.user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profilo utente non trovato';
    END IF;

    -- Ricontrollo dopo il lock.
    SELECT db.*
    INTO v_existing
    FROM public.daily_bonus_sessions AS db
    WHERE db.user_id = v_user_id
      AND db.bonus_date = v_today;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'already_played', TRUE,
            'session_id', v_existing.id,
            'bonus_date', v_existing.bonus_date,
            'base_amount', v_existing.base_amount,
            'segment_index', v_existing.segment_index,
            'multiplier', v_existing.multiplier,
            'win_amount', v_existing.win_amount,
            'balance_before', v_existing.balance_before,
            'balance_after', v_existing.balance_after,
            'next_available_at', v_next_available
        );
    END IF;

    SELECT COUNT(*)
    INTO v_segment_count
    FROM public.daily_bonus_segments;

    IF v_segment_count <> 50 THEN
        RAISE EXCEPTION
            'Configurazione Daily Bonus non valida: attesi 50 spicchi, trovati %',
            v_segment_count;
    END IF;

    -- Tutti i 50 segmenti sono equiprobabili.
    v_random_position :=
        FLOOR(
            RANDOM()
            * v_segment_count
        )::INTEGER;

    SELECT
        d.segment_index,
        d.multiplier
    INTO
        v_segment_index,
        v_multiplier
    FROM public.daily_bonus_segments AS d
    ORDER BY d.segment_index
    OFFSET v_random_position
    LIMIT 1;

    v_win_amount :=
        v_base_amount
        * v_multiplier;

    UPDATE public.profiles
    SET chips =
        chips
        + v_win_amount
    WHERE user_id = v_user_id
    RETURNING chips
    INTO v_balance_after;

    INSERT INTO public.daily_bonus_sessions (
        user_id,
        bonus_date,
        base_amount,
        segment_index,
        multiplier,
        win_amount,
        balance_before,
        balance_after
    )
    VALUES (
        v_user_id,
        v_today,
        v_base_amount,
        v_segment_index,
        v_multiplier,
        v_win_amount,
        v_balance_before,
        v_balance_after
    )
    RETURNING id
    INTO v_session_id;

    RETURN jsonb_build_object(
        'already_played', FALSE,
        'session_id', v_session_id,
        'bonus_date', v_today,
        'base_amount', v_base_amount,
        'segment_index', v_segment_index,
        'multiplier', v_multiplier,
        'win_amount', v_win_amount,
        'balance_before', v_balance_before,
        'balance_after', v_balance_after,
        'next_available_at', v_next_available
    );
END;
$$;


REVOKE ALL ON FUNCTION public.get_daily_bonus_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.spin_daily_bonus() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_daily_bonus_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.spin_daily_bonus() TO authenticated;


-- daily_bonus_sessions è lo storico completo degli accrediti.
-- Non viene scritto wallet_transactions perché la definizione esatta
-- della tabella non è inclusa qui: così non inventiamo colonne.
-- Il bonus resta comunque separato dalle giocate/classifica.

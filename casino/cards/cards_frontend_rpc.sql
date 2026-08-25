-- ============================================================
-- CARDS FRONTEND RPC V1
-- ============================================================
-- Richiede card_pack_system_v2.sql già eseguito.
-- Espone in modo sicuro la collezione dell'utente al frontend.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_card_collection()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_cards JSONB := '[]'::JSONB;
    v_unique_cards INTEGER := 0;
    v_total_copies BIGINT := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Utente non autenticato';
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COALESCE(SUM(uc.quantity),0)::BIGINT
    INTO
        v_unique_cards,
        v_total_copies
    FROM public.user_cards AS uc
    WHERE uc.user_id = v_user_id
      AND uc.quantity > 0;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'card_id', c.id,
                'code', c.code,
                'name', c.name,
                'description', c.description,
                'image_path', c.image_path,
                'tradeable', c.tradeable,
                'set_id', s.id,
                'set_name', s.name,
                'asset_folder', s.asset_folder,
                'rarity_code', r.code,
                'rarity_name', r.name,
                'rarity_color', r.display_color,
                'quantity', uc.quantity,
                'first_obtained_at', uc.first_obtained_at,
                'updated_at', uc.updated_at
            )
            ORDER BY
                s.sort_order,
                r.sort_order DESC,
                c.sort_order,
                c.name
        ),
        '[]'::JSONB
    )
    INTO v_cards
    FROM public.user_cards AS uc
    INNER JOIN public.cards AS c
        ON c.id = uc.card_id
    INNER JOIN public.card_sets AS s
        ON s.id = c.set_id
    INNER JOIN public.card_rarities AS r
        ON r.code = c.rarity_code
    WHERE uc.user_id = v_user_id
      AND uc.quantity > 0;

    RETURN jsonb_build_object(
        'summary',
            jsonb_build_object(
                'unique_cards', v_unique_cards,
                'total_copies', v_total_copies
            ),
        'cards', v_cards
    );
END;
$$;

REVOKE ALL
ON FUNCTION public.get_my_card_collection()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_my_card_collection()
TO authenticated;

COMMIT;

-- Verifica RPC disponibili per cards.html
SELECT
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc AS p
INNER JOIN pg_namespace AS n
    ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'get_my_card_collection',
      'get_my_card_packs',
      'open_card_pack',
      'buy_card_pack'
  )
ORDER BY p.proname;

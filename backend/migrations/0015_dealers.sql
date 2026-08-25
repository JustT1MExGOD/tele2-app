-- 0015_dealers.sql
--
-- Дилер (21.0) — компания (ООО/ИП), владеющая сектором целиком: над
-- Сектором пока не было записи о том, кто им реально владеет. Только
-- ownership-запись для отчётности/договоров — без своего входа/роли/
-- дашборда, тот же уровень, что sectors сейчас (заводится по имени, без
-- отдельного CRUD-экрана). Один дилер может владеть несколькими секторами
-- (FK не уникален), у сектора — ровно один дилер (или ни одного).
CREATE TABLE public.dealers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.sectors ADD COLUMN dealer_id bigint REFERENCES public.dealers(id);

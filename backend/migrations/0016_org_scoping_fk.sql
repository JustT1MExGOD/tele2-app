-- 0016_org_scoping_fk.sql
--
-- Domain Integrity audit (20.33): org-scoping (`assertStoreInOrg`/
-- `assertEmployeeInOrg`, tenant.ts) — реальный инвариант "точка/сотрудник
-- принадлежит существующей сети" жил только в TypeScript, ни разу не был
-- закреплён в БД. `employees.org_id`/`stores.org_id`/`announcements.org_id`/
-- `channels.org_id`/`channels.store_id` — обычные text-колонки без FK, хотя
-- рядом лежащие `access_requests.org_id`/`regions.org_id`/
-- `rtk_promocodes.org_id` FK уже имели с baseline. Новый код/воркер мог
-- записать несуществующий org_id — раньше только приложение мешало этому,
-- теперь и сама БД.
--
-- Проверено на проде перед миграцией (read-only): 0 строк-сирот по каждой
-- колонке, org_id нигде не NULL у employees/stores (FK не трогает NULL —
-- существующий код везде читает через COALESCE(org_id, 'default'), 'default'
-- сама существует как реальная строка organizations). Дилер→сектор
-- (`sectors.dealer_id`) и сеть→сектор (`organizations.sector_id`) уже были
-- закрыты FK с 0015/baseline — граф Дилер→Сектор→Сеть плоский, циклов не
-- бывает структурно (ни sectors, ни dealers не ссылаются сами на себя),
-- новых constraint'ов там не требуется.
ALTER TABLE public.employees
  ADD CONSTRAINT employees_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

ALTER TABLE public.stores
  ADD CONSTRAINT stores_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

ALTER TABLE public.channels
  ADD CONSTRAINT channels_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);

ALTER TABLE public.channels
  ADD CONSTRAINT channels_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);

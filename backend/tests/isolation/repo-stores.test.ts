/**
 * Data Access Layer, 19.22.0 — первые repository-уровня тесты (не через
 * HTTP/app.inject(), а прямой вызов src/data/repositories/stores.ts). Цель: сама
 * структура репозитория не даёт получить/поменять чужую сеть, а не просто
 * "роут сверху проверяет". Существующие HTTP-уровня тесты на /stores
 * (store-display-name.test.ts и т.д.) не тронуты этим коммитом и обязаны
 * пройти без изменений — это доказательство, что рефактор не поменял
 * поведение.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query } from '../../src/data/db/index.js';
import { TestFixtures } from '../helpers/fixtures.js';
import * as storesRepo from '../../src/data/repositories/stores.js';

describe('repositories/stores — org-scoping на уровне репозитория', () => {
  const fx = new TestFixtures();
  let orgA: string, orgB: string;
  let storeA: string, storeB: string;

  beforeAll(async () => {
    orgA = await fx.createOrg('Repo Org A');
    orgB = await fx.createOrg('Repo Org B');
    storeA = await fx.createStore(orgA, 'Store A');
    storeB = await fx.createStore(orgB, 'Store B');
  });

  afterAll(() => fx.cleanup());

  describe('findById', () => {
    it('видит точку своей сети', async () => {
      const store = await storesRepo.findById(orgA, storeA);
      expect(store?.id).toBe(storeA);
    });

    it('не видит точку чужой сети — null, не 403/throw', async () => {
      const store = await storesRepo.findById(orgB, storeA);
      expect(store).toBeNull();
    });
  });

  describe('list', () => {
    it('возвращает только точки своей сети', async () => {
      const stores = await storesRepo.list(orgA);
      expect(stores.some((s) => s.id === storeA)).toBe(true);
      expect(stores.some((s) => s.id === storeB)).toBe(false);
    });
  });

  describe('belongsToOrg', () => {
    it('true для своей сети, false для чужой', async () => {
      expect(await storesRepo.belongsToOrg(orgA, storeA)).toBe(true);
      expect(await storesRepo.belongsToOrg(orgB, storeA)).toBe(false);
    });

    it('false для несуществующей точки', async () => {
      expect(await storesRepo.belongsToOrg(orgA, 'no_such_store')).toBe(false);
    });
  });

  describe('update', () => {
    it('меняет точку своей сети', async () => {
      const res = await storesRepo.update(orgA, storeA, { color: '#123456' });
      expect(res?.color).toBe('#123456');
    });

    it('null на чужую сеть — ничего не меняет', async () => {
      const before = await storesRepo.findById(orgB, storeB);
      const res = await storesRepo.update(orgA, storeB, { color: '#ffffff' });
      expect(res).toBeNull();
      const after = await storesRepo.findById(orgB, storeB);
      expect(after?.color).toBe(before?.color);
    });
  });

  describe('softDelete', () => {
    it('false на чужую сеть — точка остаётся активной', async () => {
      const storeC = await fx.createStore(orgB, 'Store C (not deleted)');
      const result = await storesRepo.softDelete(orgA, storeC);
      expect(result).toBe(false);
      const check = await storesRepo.findById(orgB, storeC);
      expect(check?.is_active).toBe(true);
    });

    it('true на свою сеть — точка деактивирована', async () => {
      const storeD = await fx.createStore(orgA, 'Store D (to delete)');
      const result = await storesRepo.softDelete(orgA, storeD);
      expect(result).toBe(true);
      const check = await storesRepo.findById(orgA, storeD);
      expect(check?.is_active).toBe(false);
    });
  });

  describe('create', () => {
    it('заводит точку в указанной сети + placeholder-план', async () => {
      const id = `repo_create_test_${Date.now()}`;
      const store = await storesRepo.create(orgA, { id, name: 'Created Store' });
      fx.storeIds.push(id); // подхватить общим cleanup()
      expect(store.id).toBe(id);
      expect(store.org_id).toBe(orgA);

      const plan = await query(`SELECT 1 FROM store_plans WHERE store_id = $1 AND plan_date IS NULL`, [id]);
      expect(plan.rows.length).toBe(1);

      await query(`DELETE FROM store_plans WHERE store_id = $1`, [id]);
    });
  });
});

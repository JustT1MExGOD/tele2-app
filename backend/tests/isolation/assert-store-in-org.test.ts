import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertStoreInOrg } from '../../src/middleware-auth.js';
import { TestFixtures } from '../helpers/fixtures.js';

describe('assertStoreInOrg', () => {
  const fx = new TestFixtures();
  let orgA: string;
  let orgB: string;
  let storeA: string;

  beforeAll(async () => {
    orgA = await fx.createOrg('Org A');
    orgB = await fx.createOrg('Org B');
    storeA = await fx.createStore(orgA);
  });

  afterAll(() => fx.cleanup());

  it('true для точки своей сети', async () => {
    expect(await assertStoreInOrg(storeA, orgA)).toBe(true);
  });

  it('false для точки чужой сети', async () => {
    expect(await assertStoreInOrg(storeA, orgB)).toBe(false);
  });

  it('false для несуществующей точки', async () => {
    expect(await assertStoreInOrg('does_not_exist_xyz', orgA)).toBe(false);
  });
});

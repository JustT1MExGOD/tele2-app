import { describe, it, expect } from 'vitest';
import { resolveViewOrgId, canAssignRole, type AuthUser } from '../../src/middleware-auth.js';

function user(role: AuthUser['role'], orgId: string): AuthUser {
  return {
    telegram_id: 1,
    employee_id: 1,
    full_name: 'Test',
    role,
    access_status: 'active',
    org_id: orgId
  };
}

describe('resolveViewOrgId', () => {
  it('admin с override видит явно запрошенную сеть', () => {
    expect(resolveViewOrgId(user('admin', 'default'), 'other_org')).toBe('other_org');
  });

  it('admin без override видит свою сеть', () => {
    expect(resolveViewOrgId(user('admin', 'default'), undefined)).toBe('default');
    expect(resolveViewOrgId(user('admin', 'default'), null)).toBe('default');
  });

  it('manager с override — override игнорируется, видна только своя сеть', () => {
    expect(resolveViewOrgId(user('manager', 'default'), 'other_org')).toBe('default');
  });

  it('обычный сотрудник — всегда своя сеть, override не пробуется', () => {
    expect(resolveViewOrgId(user('employee', 'rtt_gureeva'), 'default')).toBe('rtt_gureeva');
  });
});

describe('canAssignRole', () => {
  it('admin может назначить любую роль, включая admin', () => {
    expect(canAssignRole('admin', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'manager')).toBe(true);
    expect(canAssignRole('admin', 'trainee')).toBe(true);
  });

  it('manager может назначать только роли строго ниже своей', () => {
    expect(canAssignRole('manager', 'senior')).toBe(true);
    expect(canAssignRole('manager', 'employee')).toBe(true);
    expect(canAssignRole('manager', 'manager')).toBe(false);
    expect(canAssignRole('manager', 'admin')).toBe(false);
  });

  it('supervisor не может назначить роль supervisor или выше', () => {
    expect(canAssignRole('supervisor', 'manager')).toBe(true);
    expect(canAssignRole('supervisor', 'supervisor')).toBe(false);
    expect(canAssignRole('supervisor', 'admin')).toBe(false);
  });
});

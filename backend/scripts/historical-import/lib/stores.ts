/** Store name -> production store_id, confirmed against the live `stores` table. */
export const STORE_NAME_TO_ID: Record<string, string> = {
  'Калинина 2': 'kalinina2',
  'Космонавтов 20а': 'kosmonavtov',
};

export function storeIdForName(name: string): string | null {
  return STORE_NAME_TO_ID[name.trim()] ?? null;
}

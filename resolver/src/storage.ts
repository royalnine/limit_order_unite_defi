import { kv } from '@vercel/kv';

export interface StoredOrder {
  id: string;
  order: any;
  signature: string;
  timestamp: number;
  reconstructedOrder?: any;
  limitPriceUsd: number;
  isLong: boolean;
}

export class OrderStorage {
  static async set(id: string, order: StoredOrder): Promise<void> {
    await kv.set(`order:${id}`, order);
  }

  static async get(id: string): Promise<StoredOrder | null> {
    return await kv.get(`order:${id}`);
  }

  static async has(id: string): Promise<boolean> {
    return (await kv.get(`order:${id}`)) !== null;
  }

  static async delete(id: string): Promise<void> {
    await kv.del(`order:${id}`);
  }

  static async values(): Promise<StoredOrder[]> {
    const keys = await kv.keys('order:*');
    const orders = await Promise.all(
      keys.map(async (key) => await kv.get(key))
    );
    return orders.filter(Boolean) as StoredOrder[];
  }
}

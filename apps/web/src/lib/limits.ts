import { NextResponse } from 'next/server';
import { getStore } from './store';

// Fixed one-minute windows, per process. Swap for Redis when running more than one server.
const WINDOW_MS = 60_000;
const MAX_TRACKED = 50_000;

const g = globalThis as unknown as { __omniRate?: Map<string, { start: number; count: number }> };
const windows = (g.__omniRate ??= new Map());

export const LIMITS = {
  chatGuest: 10,
  chatUser: 30,
  api: 60,
  keyChecks: 10,
} as const;

export function rateLimit(bucket: string, id: string, perMinute: number): NextResponse | null {
  const now = Date.now();
  const key = `${bucket}:${id}`;
  const w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    if (windows.size >= MAX_TRACKED) {
      for (const [k, v] of windows) if (now - v.start >= WINDOW_MS) windows.delete(k);
    }
    windows.set(key, { start: now, count: 1 });
    return null;
  }
  if (w.count < perMinute) {
    w.count += 1;
    return null;
  }
  const retryAfter = Math.ceil((w.start + WINDOW_MS - now) / 1000);
  return NextResponse.json(
    { error: `Too many requests. Try again in ${retryAfter}s.` },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

export interface Budget {
  capUsd: number | null;
  spentUsd: number;
  /** USD left this month, or undefined when there is no cap. */
  remainingUsd?: number;
}

export async function budgetFor(owner: string): Promise<Budget> {
  const store = getStore();
  const [capUsd, spentUsd] = await Promise.all([store.getMonthlyCap(owner), store.monthlySpend(owner)]);
  return {
    capUsd,
    spentUsd,
    ...(capUsd !== null ? { remainingUsd: Math.max(0, capUsd - spentUsd) } : {}),
  };
}

export function overBudget(b: Budget): NextResponse | null {
  if (b.remainingUsd === undefined || b.remainingUsd > 0) return null;
  return NextResponse.json(
    { error: `Monthly spending limit of $${b.capUsd!.toFixed(2)} reached. Raise it in Settings.` },
    { status: 402 },
  );
}

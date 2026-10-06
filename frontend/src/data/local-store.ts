import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'
import type { LightingSidecar } from './lighting-domain'
import { INITIAL_STOCK } from './lighting-domain'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'
// 廊内照明整组处理的侧车存储：批次回执、维保台账、待补清单、重复上报留档、审计。
const SIDECAR_KEY = 'urban-utility-tunnel:lighting'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/* ----------------------------- 照明侧车存储 ----------------------------- */

export function emptySidecar(): LightingSidecar {
  return {
    ledger: [],
    batches: [],
    supplements: [],
    duplicates: [],
    audit: [],
    stock: { ...INITIAL_STOCK },
    seq: 1,
    inited: false,
  }
}

export function readSidecar(): LightingSidecar {
  const fallback = emptySidecar()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(SIDECAR_KEY)
  if (!raw) {
    return fallback
  }
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<LightingSidecar>) }
  } catch {
    return fallback
  }
}

export function saveSidecar(sidecar: LightingSidecar): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SIDECAR_KEY, JSON.stringify(sidecar))
  }
}

export function resetSidecar(): LightingSidecar {
  const next = emptySidecar()
  saveSidecar(next)
  return next
}

export function sidecarKey(): string {
  return SIDECAR_KEY
}

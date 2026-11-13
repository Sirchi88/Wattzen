import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { WattzenDB } from './db'

describe('IndexedDB-Migration Version 1 → 2', () => {
  it('übernimmt Ablesungen, Tarife und Einstellungen und verschiebt den Kilometerstand', async () => {
    const name = 'wattzen-migration-test'
    const v1 = new Dexie(name)
    v1.version(1).stores({
      readings: 'id, date', tariffs: 'id, from', feedins: 'id, from', abschlaege: 'id, from',
      meterChanges: 'id, date', settings: 'key',
    })
    await v1.open()
    await v1.table('readings').bulkPut([
      { id: 'a', date: '2025-01-01', values: { bezug: 100, einsp: 50, wrEinsp: 70 }, km: 41000 },
      { id: 'b', date: '2025-02-01', values: { bezug: 300, einsp: 80 } },
    ])
    await v1.table('tariffs').put({ id: 't', kind: 'haushalt', from: '2025-01-01', arbeitspreis: 30, grundgebuehr: 12 })
    await v1.table('meterChanges').put({ id: 'c', meter: 'bezug', date: '2025-01-15', endOld: 200, startNew: 0 })
    await v1.table('settings').put({ key: 'main', value: { onboarded: true, showKm: true, theme: 'light', lastBackup: '2025-01-01' } })
    v1.close()

    const db = new WattzenDB(name)
    await db.open()
    expect(db.verno).toBe(2)
    const rs = await db.readings.orderBy('date').toArray()
    expect(rs).toHaveLength(2)
    expect(rs[0].values).toEqual({ bezug: 100, einsp: 50, wrEinsp: 70, km: 41000 })
    expect('km' in rs[0]).toBe(false)
    expect(rs[1].values).toEqual({ bezug: 300, einsp: 80 })
    expect(await db.tariffs.count()).toBe(1)
    expect(await db.meterChanges.count()).toBe(1)
    const km = await db.meters.get('km')
    expect(km?.active).toBe(true)
    const s = (await db.settings.get('main'))!.value as unknown as Record<string, unknown>
    expect(s.theme).toBe('light')
    expect(s.onboarded).toBe(true)
    expect('showKm' in s).toBe(false)
    expect(await db.feedinAbschlaege.count()).toBe(0)
    db.close()
  })
})

import { addMonths, fromDay, monthStart } from '../lib/dates'

export interface IcsEvent {
  uid: string
  title: string
  description?: string
  /** Tag (Tage seit 1970) */
  day: number
  /** 'HH:MM' */
  time: string
  durationMin?: number
  /** z. B. 'FREQ=MONTHLY;BYMONTHDAY=1' */
  rrule?: string
  /** Erinnerung in Minuten vor Beginn (0 = zum Termin) */
  alarmMin?: number
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

const stamp = (day: number, time: string) => `${fromDay(day).replace(/-/g, '')}T${time.replace(':', '')}00`

/** Zeilen über 75 Oktette werden laut RFC 5545 gefaltet. */
const fold = (line: string) => {
  const out: string[] = []
  let rest = line
  while (rest.length > 73) {
    out.push(rest.slice(0, 73))
    rest = ' ' + rest.slice(73)
  }
  out.push(rest)
  return out.join('\r\n')
}

/** Kalenderdatei (RFC 5545) mit lokaler, „schwebender“ Uhrzeit – passt in jeder Zeitzone. */
export function makeIcs(events: IcsEvent[], now = new Date()): string {
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WATTZEN//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  for (const e of events) {
    const [h, mi] = e.time.split(':').map(Number)
    const endMin = h * 60 + mi + (e.durationMin ?? 15)
    const endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(e.day, e.time)}`,
      `DTEND:${stamp(e.day, endTime)}`,
      `SUMMARY:${esc(e.title)}`,
    )
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`)
    if (e.rrule) lines.push(`RRULE:${e.rrule}`)
    if (e.alarmMin !== undefined)
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${e.alarmMin}M`, 'END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Monatlicher Termin „Werte ablesen“ am 1., beginnend mit dem nächsten Monatsersten. */
export function readingReminder(today: number, time: string) {
  const first = monthStart(today) === today ? today : addMonths(monthStart(today), 1)
  return makeIcs([
    {
      uid: 'wattzen-ablesen@wattzen',
      title: 'Werte ablesen',
      description: 'Zählerstände in WATTZEN erfassen.',
      day: first,
      time,
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
      alarmMin: 0,
    },
  ])
}

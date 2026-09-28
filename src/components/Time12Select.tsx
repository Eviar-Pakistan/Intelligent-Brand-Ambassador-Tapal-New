const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

/** 12-hour picker. Value in and out is 24-hour HH:MM so the API stays the same. */
export function Time12Select({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [h, m] = value.split(':').map(Number)
  const pm = h >= 12
  const hour12 = h % 12 || 12
  const minute = String(m).padStart(2, '0')

  function set(nextHour12: number, nextMinute: string, nextPm: boolean) {
    const hour24 = (nextHour12 % 12) + (nextPm ? 12 : 0)
    onChange(`${String(hour24).padStart(2, '0')}:${nextMinute}`)
  }

  const cls = 'min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-sm outline-none focus:border-brand-500'
  return (
    <div className="flex gap-1.5">
      <select aria-label="Hour" value={hour12} onChange={(e) => set(Number(e.target.value), minute, pm)} className={cls}>
        {HOURS.map((hour) => (
          <option key={hour} value={hour}>
            {hour}
          </option>
        ))}
      </select>
      <select aria-label="Minute" value={minute} onChange={(e) => set(hour12, e.target.value, pm)} className={cls}>
        {(MINUTES.includes(minute) ? MINUTES : [minute, ...MINUTES]).map((mm) => (
          <option key={mm} value={mm}>
            {mm}
          </option>
        ))}
      </select>
      <select aria-label="AM or PM" value={pm ? 'PM' : 'AM'} onChange={(e) => set(hour12, minute, e.target.value === 'PM')} className={cls}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}

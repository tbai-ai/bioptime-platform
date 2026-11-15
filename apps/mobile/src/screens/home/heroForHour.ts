/* The Home greeting and its hero photo by the hour of the day (the earlier app's HomeTab rule, AMENDED §6): 05–12
   morning (sunrise, amber-400), 12–17 afternoon (sun, white/60), 17–21 evening (sunset, orange-400), else night (moon,
   light blue at .70). The same hour picks the hero slot, and every hero is people-free (the member's name sits on
   it). The hour is the device clock's; useDayPart() looks again every 60 s so the greeting turns over at the hour. */
import { useEffect, useMemo, useState } from 'react';
import { fx } from '@/theme';
import type { IconName } from '@/fx';

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export type Greeting = {
  part: DayPart;
  /** "Good morning" (sentence case; the eyebrow draws it in capitals). */
  text: string;
  icon: IconName;
  color: string;
  /** The hero photo slot for this part of the day. */
  slot: `home.hero.${DayPart}`;
};

export function dayPartFor(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

const LOOK: Record<DayPart, { icon: IconName; color: string }> = {
  morning: { icon: 'sunrise', color: fx.hue.amber400 },
  afternoon: { icon: 'sun', color: fx.ink.a60 },
  evening: { icon: 'sunset', color: fx.hue.orange400 },
  night: { icon: 'moon', color: fx.hue.night },
};

export function greetingFor(hour: number): Greeting {
  const part = dayPartFor(hour);
  return { part, text: `Good ${part}`, ...LOOK[part], slot: `home.hero.${part}` };
}

/** The greeting for now, checked again every minute (it changes at 05, 12, 17 and 21). */
export function useDayPart(): Greeting {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const timer = setInterval(() => { const h = new Date().getHours(); setHour((was) => (was === h ? was : h)); }, 60_000);
    return () => clearInterval(timer);
  }, []);
  return useMemo(() => greetingFor(hour), [hour]); // the same object until the hour turns (the header is memoised)
}

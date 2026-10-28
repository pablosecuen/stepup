// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarWeekday.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { appWeekdayToJsDay, jsDayToAppWeekday } from '../calendarWeekday.ts';
import { assertEqual, test } from './testHarness.ts';

test('mapea los siete días entre Date y AppWeekday', () => {
  const expected = [6, 0, 1, 2, 3, 4, 5] as const;
  expected.forEach((appDay, jsDay) => {
    assertEqual(jsDayToAppWeekday(jsDay), appDay, `mapeo JS ${jsDay}`);
    assertEqual(appWeekdayToJsDay(appDay), jsDay, `round-trip ${appDay}`);
  });
});

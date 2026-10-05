import { expect, it } from 'vitest';
import { readResource, removeResources, saveResource } from '../../src/services/offlineStore';

it('bounds persisted resources and retains the newest data', async () => {
  await removeResources('');
  for (let i = 0; i < 165; i++) await saveResource(`bounded:${i}`, { value: i }, i + 1);
  expect(await readResource('bounded:0')).toBeNull();
  expect((await readResource<{ value: number }>('bounded:164'))?.data.value).toBe(164);
});

it('exact account deletion cannot remove a similarly prefixed account', async () => {
  await saveResource('photo:1', 'one'); await saveResource('photo:10', 'ten');
  await removeResources('photo:1', true);
  expect(await readResource('photo:1')).toBeNull();
  expect((await readResource<string>('photo:10'))?.data).toBe('ten');
});

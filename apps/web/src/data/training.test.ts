import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { countSet, createBackup, finishSession, initialData, parseBackup, saveConfig, statistics, validateData } from './model';
import { ConflictError, loadData, saveData } from './legacyStorage';

function configured() {
  const data = initialData(); data.chosen = true;
  data.configs = [0, 1, 2, 3].map(day => [{ id: `${day}-0-0`, sets: 4 }]);
  return data;
}
describe('训练记录与历史', () => {
  it('加组封顶、撤销不为负，只能记录当前分化', () => {
    const data = configured();
    for (let i = 0; i < 6; i++) countSet(data, '0-0-0', 1);
    expect(data.counts['0-0-0']).toBe(4);
    expect(() => countSet(data, '1-0-0', 1)).toThrow();
    for (let i = 0; i < 6; i++) countSet(data, '0-0-0', -1);
    expect(data.counts['0-0-0']).toBe(0);
  });
  it('未满目标结束时保存真实组数，四分化循环不会删除历史', () => {
    const data = configured();
    countSet(data, '0-0-0', 1, new Date('2026-10-22T10:00:00Z'));
    finishSession(data, new Date('2026-10-22T10:30:00Z'));
    expect(data.current).toBe(1);
    expect(data.history[0].exercises[0]).toMatchObject({ completed: 1, target: 4 });
    for (let i = 0; i < 3; i++) finishSession(data, new Date('2026-10-23T10:30:00Z'));
    expect(data.current).toBe(0);
    expect(data.counts['0-0-0']).toBeUndefined();
    expect(data.history).toHaveLength(4);
    expect(statistics(data)).toEqual({ sessions: 1, sets: 1, days: 1 });
  });
  it('修改设置只影响本轮，历史是不可变快照', () => {
    const data = configured(); countSet(data, '0-0-0', 1); finishSession(data);
    saveConfig(data, 0, []);
    expect(data.counts['0-0-0']).toBeUndefined();
    expect(data.history[0].exercises[0].completed).toBe(1);
    expect(data.history[0].exercises[0].target).toBe(4);
  });
  it('跨天仍保持本轮，结束日期按结束时本机日期记录', () => {
    const data = configured(); countSet(data, '0-0-0', 1, new Date(2026, 9, 22, 23, 50));
    finishSession(data, new Date(2026, 9, 23, 0, 10));
    expect(data.history[0].date).toBe('2026-10-23');
    expect(data.history[0].exercises[0].completed).toBe(1);
  });
  it('没有配置或零组也能结束，不计入实际训练统计', () => {
    const data = initialData(); finishSession(data);
    expect(data.history[0].exercises).toEqual([]);
    expect(statistics(data).sessions).toBe(0);
  });
});
describe('备份校验', () => {
  it('配置、历史和未完成的本轮可以完整往返', () => {
    const data = configured(); countSet(data, '0-0-0', 1); finishSession(data); countSet(data, '1-0-0', 1);
    expect(parseBackup(createBackup(data))).toEqual(data);
  });
  it.each([
    (data: ReturnType<typeof initialData>) => { data.configs[0][0].sets = -1; },
    (data: ReturnType<typeof initialData>) => { data.configs[0].push({ ...data.configs[0][0] }); },
    (data: ReturnType<typeof initialData>) => { data.counts['0-0-0'] = 100; },
    (data: ReturnType<typeof initialData>) => { data.configs[0][0].id = '1-0-0'; },
    (data: ReturnType<typeof initialData>) => { data.current = 9; },
    (data: ReturnType<typeof initialData>) => { data.history[0].exercises[0].completed = -1; },
  ])('拒绝非法备份，避免坏数据进入数据库', mutate => {
    const data = configured(); countSet(data, '0-0-0', 1); finishSession(data); mutate(data);
    expect(() => validateData(data)).toThrow();
  });
  it('拒绝损坏 JSON 与不兼容版本', () => {
    expect(() => parseBackup('{')).toThrow();
    expect(() => parseBackup(JSON.stringify({ app: 'fitness-tracker', formatVersion: 99 }))).toThrow();
  });
});
describe('IndexedDB 事务', () => {
  it('读写保留配置、进度与历史；拒绝旧版本覆盖；恢复备份', async () => {
    const initial = await loadData();
    const next = configured(); countSet(next, '0-0-0', 1); finishSession(next);
    const saved = await saveData(next, initial.revision);
    expect(await loadData()).toEqual(saved);
    await expect(saveData(initial, initial.revision)).rejects.toBeInstanceOf(ConflictError);
    expect(await loadData()).toEqual(saved);
    const backup = parseBackup(createBackup(saved));
    const cleared = await saveData(initialData(), saved.revision);
    expect((await loadData()).history).toHaveLength(0);
    const restored = await saveData(backup, cleared.revision);
    expect((await loadData()).history).toEqual(backup.history);
    await expect(saveData({ ...restored, current: 8 }, restored.revision)).rejects.toThrow();
    expect(await loadData()).toEqual(restored);
  });
});

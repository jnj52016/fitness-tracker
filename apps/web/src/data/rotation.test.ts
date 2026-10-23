import { describe, expect, it } from 'vitest';
import { activeExercises, configFor, countSet, finishSession, initialData, saveConfig, setFrequency, switchLeg, validateData } from './model';
describe('A/B 自动轮换与频率', () => {
  it('旧数据迁移保留训练进度，A/B 独立且旧历史不伪造方案', () => {
    const old = { version: 1, revision: 8, chosen: true, current: 2, configs: [[], [], [{ id: '2-0-0', sets: 4 }], []], counts: { '2-0-0': 2 }, startedAt: '2026-10-23T01:00:00Z', history: [] };
    const data = validateData(old);
    expect(data.version).toBe(2); expect(data.revision).toBe(8);
    expect(data.legB).toEqual(old.configs[2]); expect(data.counts).toEqual(old.counts);
    expect(data.legB).not.toBe(data.configs[2]);
    saveConfig(data, 2, [{ id: '2-1-0', sets: 3 }], 'B');
    expect(data.configs[2]).toEqual(old.configs[2]); expect(data.counts['2-0-0']).toBe(2);
    expect(() => switchLeg(data)).toThrow('已开始');
  });
  it('结束 A 自动换 B，四分化后用 B，再结束换 A；历史保留实际方案', () => {
    const data = initialData(); data.current = 2;
    saveConfig(data, 2, [{ id: '2-0-0', sets: 4 }], 'A');
    saveConfig(data, 2, [{ id: '2-1-0', sets: 3 }], 'B');
    countSet(data, '2-0-0', 1); finishSession(data);
    expect(data.history[0]).toMatchObject({ legVariant: 'A', exercises: [{ completed: 1 }] });
    expect(data.legNext).toBe('B'); expect(data.counts['2-0-0']).toBeUndefined();
    for (let i = 0; i < 3; i++) finishSession(data);
    expect(data.current).toBe(2); expect(configFor(data, 2)[0].id).toBe('2-1-0');
    countSet(data, '2-1-0', 1); finishSession(data);
    expect(data.history[0].legVariant).toBe('B'); expect(data.legNext).toBe('A');
    expect(validateData(data).history.filter(item => item.legVariant)).toHaveLength(2);
  });
  it('未开始可切换，开始后不可切换，编辑非当前套不覆盖组数', () => {
    const data = initialData(); data.current = 2;
    saveConfig(data, 2, [{ id: '2-0-0', sets: 4 }], 'A');
    saveConfig(data, 2, [{ id: '2-0-0', sets: 6 }], 'B');
    switchLeg(data); countSet(data, '2-0-0', 1);
    saveConfig(data, 2, [], 'A'); expect(data.counts['2-0-0']).toBe(1);
    expect(() => switchLeg(data)).toThrow(); expect(validateData(data).legB[0].sets).toBe(6);
  });
  it('隔轮只排除胸腹，肩臂保留；配置与历史不被删除', () => {
    const data = initialData(); data.current = 1;
    saveConfig(data, 1, [{ id: '1-0-0', sets: 4 }, { id: '1-3-0', sets: 4 }]);
    saveConfig(data, 3, [{ id: '3-0-0', sets: 4 }, { id: '3-2-0', sets: 4 }]);
    setFrequency(data, 'chest', 'alternate'); setFrequency(data, 'abs', 'alternate');
    expect(activeExercises(data, 1)).toHaveLength(2);
    countSet(data, '1-0-0', 1); expect(() => setFrequency(data, 'chest', 'every')).toThrow();
    for (let i = 0; i < 4; i++) finishSession(data);
    expect(data.round).toBe(2); expect(data.current).toBe(1);
    expect(activeExercises(data, 1).map(item => item.id)).toEqual(['1-3-0']);
    expect(activeExercises(data, 3).map(item => item.id)).toEqual(['3-0-0']);
    expect(() => countSet(data, '1-0-0', 1)).toThrow();
    expect(data.configs[1]).toHaveLength(2);
    for (let i = 0; i < 4; i++) finishSession(data);
    expect(data.round).toBe(3); expect(activeExercises(data, 1)).toHaveLength(2);
    expect(data.history.some(item => item.exercises.some(exercise => exercise.id === '1-0-0' && exercise.completed === 1))).toBe(true);
  });
  it('拒绝非法 B 动作、频率和轮次；新增状态可完整读写', () => {
    const data = initialData(); data.legB = [{ id: '2-2-0', sets: 6 }]; data.legNext = 'B'; data.round = 2;
    expect(validateData(data)).toEqual(data);
    expect(() => validateData({ ...data, legB: [{ id: '1-0-0', sets: 4 }] })).toThrow();
    expect(() => validateData({ ...data, legNext: 'C' })).toThrow();
    expect(() => validateData({ ...data, round: 0 })).toThrow();
    expect(() => validateData({ ...data, frequency: { chest: 'invalid', abs: 'every' } })).toThrow();
  });
});

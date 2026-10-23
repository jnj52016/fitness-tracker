import { exercises, splits } from './plan';

export interface ExerciseConfig { id: string; sets: number }
export interface SessionExercise { id: string; name: string; target: number; completed: number }
export interface Session {
  id: string;
  day: number;
  date: string;
  startedAt: string;
  endedAt: string;
  exercises: SessionExercise[];
  legVariant?: 'A' | 'B';
}
export interface TrainingData {
  version: 2;
  legB: ExerciseConfig[];
  legNext: 'A' | 'B';
  round: number;
  frequency: { chest: 'every' | 'alternate'; abs: 'every' | 'alternate' };
  revision: number;
  chosen: boolean;
  current: number;
  configs: ExerciseConfig[][];
  counts: Record<string, number>;
  startedAt: string | null;
  history: Session[];
}
export const initialData = (): TrainingData => ({ version: 2, legB: [], legNext: 'A', round: 1, frequency: { chest: 'every', abs: 'every' }, revision: 0, chosen: false, current: 0, configs: [[], [], [], []], counts: {}, startedAt: null, history: [] });
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function configFor(data: TrainingData, day: number, variant = data.legNext): ExerciseConfig[] {
  return day === 2 && variant === 'B' ? data.legB : data.configs[day];
}
export function roundFor(data: TrainingData, day: number) { return data.round + (day < data.current ? 1 : 0); }
export function activeExercises(data: TrainingData, day: number) {
  const round = roundFor(data, day);
  return configFor(data, day).filter(item => !(
    (day === 1 && /^1-[012]-/.test(item.id) && data.frequency.chest === 'alternate' && round % 2 === 0) ||
    (day === 3 && item.id.startsWith('3-2-') && data.frequency.abs === 'alternate' && round % 2 === 0)
  ));
}
export function totals(data: TrainingData, day: number) {
  return activeExercises(data, day).reduce((sum, item) => ({ target: sum.target + item.sets, done: sum.done + (data.counts[item.id] || 0) }), { target: 0, done: 0 });
}
export function countSet(data: TrainingData, id: string, amount: 1 | -1, now = new Date()) {
  const item = activeExercises(data, data.current).find(item => item.id === id);
  if (!item) throw new Error('只能记录当前分化中已选择且本轮安排的动作');
  data.counts[id] = Math.min(item.sets, Math.max(0, (data.counts[id] || 0) + amount));
  if (amount > 0 && !data.startedAt) data.startedAt = now.toISOString();
}
export function saveConfig(data: TrainingData, day: number, config: ExerciseConfig[], variant = data.legNext) {
  const selected = new Set(config.map(item => item.id));
  if (day !== 2 || variant === data.legNext) {
    configFor(data, day, variant).forEach(item => { if (!selected.has(item.id)) delete data.counts[item.id]; });
    config.forEach(item => { data.counts[item.id] = Math.min(data.counts[item.id] || 0, item.sets); });
  }
  if (day === 2 && variant === 'B') data.legB = structuredClone(config);
  else data.configs[day] = structuredClone(config);
}
export function switchLeg(data: TrainingData) {
  if (data.current === 2 && (data.startedAt || Object.entries(data.counts).some(([id, n]) => id.startsWith('2-') && n > 0))) throw new Error('本次腿臀已开始，请先结束训练后再切换');
  Object.keys(data.counts).filter(id => id.startsWith('2-')).forEach(id => delete data.counts[id]);
  data.legNext = data.legNext === 'A' ? 'B' : 'A';
}
export function setFrequency(data: TrainingData, part: 'chest' | 'abs', value: 'every' | 'alternate') {
  const day = part === 'chest' ? 1 : 3;
  if (data.current === day && (data.startedAt || totals(data, day).done > 0)) throw new Error('本次训练已开始，请结束后再调整频率');
  data.frequency[part] = value;
}
export function finishSession(data: TrainingData, now = new Date()) {
  const endedAt = now.toISOString();
  // getRandomValues is also available on a phone accessing a LAN HTTP address.
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  data.history.unshift({
    id, day: data.current, date: localDate(now), startedAt: data.startedAt || endedAt, endedAt,
    ...(data.current === 2 ? { legVariant: data.legNext } : {}),
    exercises: activeExercises(data, data.current).map(item => ({ id: item.id, name: exercises.find(exercise => exercise.id === item.id)!.name, target: item.sets, completed: data.counts[item.id] || 0 })),
  });
  if (data.current === 2) {
    Object.keys(data.counts).filter(id => id.startsWith('2-')).forEach(id => delete data.counts[id]);
    data.legNext = data.legNext === 'A' ? 'B' : 'A';
  }
  if (data.current === 3) data.round++;
  data.current = (data.current + 1) % splits.length;
  configFor(data, data.current).forEach(item => { delete data.counts[item.id]; });
  data.startedAt = null;
}
export function statistics(data: TrainingData) {
  const trained = data.history.filter(session => session.exercises.some(item => item.completed > 0));
  return {
    sessions: trained.length,
    sets: trained.reduce((sum, session) => sum + session.exercises.reduce((n, item) => n + item.completed, 0), 0),
    days: new Set(trained.map(session => session.date)).size,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

/** Rebuild an allowlisted object; imported JSON never becomes HTML or executable content. */
export function validateData(input: unknown): TrainingData {
  requireValue(isRecord(input) && (input.version === 1 || input.version === 2), '无法识别此数据版本，请使用本应用导出的备份');
  requireValue(typeof input.chosen === 'boolean' && integer(input.current, 0, 3) && integer(input.revision, 0, Number.MAX_SAFE_INTEGER), '训练状态格式不正确');
  requireValue(Array.isArray(input.configs) && input.configs.length === 4, '训练配置必须包含四个分化');
  const validateConfig = (list: unknown, day: number) => {
    requireValue(Array.isArray(list) && list.length <= exercises.length, '动作列表格式不正确');
    const ids = new Set<string>();
    return list.map((item: unknown) => {
      requireValue(isRecord(item) && typeof item.id === 'string' && splits[day].groups.some(group => group.items.some(exercise => exercise.id === item.id)) && integer(item.sets, 1, 20), '动作或目标组数不正确');
      requireValue(!ids.has(item.id), '同一分化不能重复选择相同动作'); ids.add(item.id);
      return { id: item.id, sets: item.sets };
    });
  };
  const configs = input.configs.map(validateConfig);
  const legacy = input.version === 1;
  const legB = legacy ? structuredClone(configs[2]) : validateConfig(input.legB, 2);
  const legNext = legacy ? 'A' : input.legNext;
  const round = legacy ? 1 : input.round;
  const frequency = legacy ? { chest: 'every', abs: 'every' } : input.frequency;
  requireValue(legNext === 'A' || legNext === 'B', '腿臀方案不正确');
  requireValue(integer(round, 1, 1000000), '训练轮次不正确');
  requireValue(isRecord(frequency) && ['every', 'alternate'].includes(String(frequency.chest)) && ['every', 'alternate'].includes(String(frequency.abs)), '训练频率不正确');
  requireValue(isRecord(input.counts), '完成组数格式不正确');
  const counts: Record<string, number> = {};
  for (const [id, count] of Object.entries(input.counts)) {
    const config = [...configs.filter((_, day) => day !== 2).flat(), ...(legNext === 'A' ? configs[2] : legB)].find(item => item.id === id);
    requireValue(config && integer(count, 0, config.sets), '完成组数超过目标或动作不存在');
    counts[id] = count;
  }
  requireValue(input.startedAt === null || isoDate(input.startedAt), '训练开始时间不正确');
  requireValue(Array.isArray(input.history) && input.history.length <= 10000, '历史记录格式不正确或超过 10000 条');
  const sessionIds = new Set<string>();
  const history = input.history.map((session: unknown): Session => {
    requireValue(isRecord(session) && typeof session.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(session.id) && !sessionIds.has(session.id) && integer(session.day, 0, 3), '训练记录标识不正确或重复');
    sessionIds.add(session.id);
    requireValue(isoDate(session.startedAt) && isoDate(session.endedAt) && Date.parse(session.startedAt) <= Date.parse(session.endedAt), '历史时间不正确');
    requireValue(typeof session.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(session.date) && new Date(session.date + 'T00:00:00Z').toISOString().slice(0, 10) === session.date, '历史日期不正确');
    requireValue(Array.isArray(session.exercises) && session.exercises.length <= exercises.length, '历史动作格式不正确');
    const ids = new Set<string>();
    const items = session.exercises.map((item: unknown) => {
      requireValue(isRecord(item) && typeof item.id === 'string', '历史动作格式不正确');
      const exercise = splits[session.day as number].groups.flatMap(group => group.items).find(exercise => exercise.id === item.id);
      requireValue(exercise && !ids.has(item.id) && integer(item.target, 1, 20) && integer(item.completed, 0, item.target), '历史动作或组数不正确');
      ids.add(item.id);
      return { id: item.id, name: exercise.name, target: item.target, completed: item.completed };
    });
    requireValue(session.legVariant === undefined || (session.day === 2 && (session.legVariant === 'A' || session.legVariant === 'B')), '历史腿臀方案不正确');
    return { ...(session.legVariant ? { legVariant: session.legVariant as 'A' | 'B' } : {}), id: session.id, day: session.day, date: session.date, startedAt: session.startedAt, endedAt: session.endedAt, exercises: items };
  }).sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  return { version: 2, legB, legNext, round, frequency: { chest: frequency.chest as 'every' | 'alternate', abs: frequency.abs as 'every' | 'alternate' }, revision: input.revision, chosen: input.chosen, current: input.current, configs, counts, startedAt: input.startedAt, history };
}
export function parseBackup(text: string): TrainingData {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON 备份'); }
  requireValue(isRecord(value) && value.app === 'fitness-tracker' && value.formatVersion === 1, '请选择本应用导出的备份文件');
  return validateData(value.data);
}
export function createBackup(data: TrainingData) {
  return JSON.stringify({ app: 'fitness-tracker', formatVersion: 1, exportedAt: new Date().toISOString(), data: validateData(data) }, null, 2);
}

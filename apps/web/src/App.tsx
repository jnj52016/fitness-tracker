import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App as AntApp, Button, Empty, Modal, Select, Spin } from 'antd';
import Icon from './Icon';
import { exercises, PLAN_NAME, planGuidance, splits } from './data/plan';
import { activeExercises, configFor, countSet, finishSession, roundFor, saveConfig, setFrequency, statistics, switchLeg, totals, type ExerciseConfig, type Session, type TrainingData } from './data/model';
import { ConflictError, loadData, saveData } from './data/storage';

type Page = 'training' | 'history';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';

function PlanGuidance() {
  return <details className="plan-guidance"><summary>男女训练建议</summary><p>这份计划可以这样安排，你也可以按自己的目标和体力调整。</p><dl>{planGuidance.map(item => <div key={item.title}><dt>{item.title}</dt><dd>{item.text}</dd></div>)}</dl></details>;
}

export default function App({ username = '', onLogout, logoutBusy = false }: { username?: string; onLogout?: () => Promise<void>; logoutBusy?: boolean }) {
  const { message, modal } = AntApp.useApp();
  const [data, setData] = useState<TrainingData>();
  const dataRef = useRef<TrainingData | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState<Page>('training');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const [editDay, setEditDay] = useState<number | null>(null);
  const [editLeg, setEditLeg] = useState<'A' | 'B'>('A');
  const [draft, setDraft] = useState<ExerciseConfig[]>([]);
  const editRevision = useRef(0);
  const originalDraft = useRef('');
  const [help, setHelp] = useState(false);
  const [historyDay, setHistoryDay] = useState<number | undefined>();
  const [historyMonth, setHistoryMonth] = useState('');
  const [historyLimit, setHistoryLimit] = useState(10);
  const accept = useCallback((value: TrainingData) => { dataRef.current = value; setData(value); setLoadError(''); }, []);
  const reload = useCallback(async () => {
    if (locked.current) return;
    try { accept(await loadData()); } catch (error) { setLoadError(errorMessage(error)); }
  }, [accept]);
  useEffect(() => {
    void reload();
    const refresh = () => { void reload(); };
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('fitness-tracker-updates');
      channel.current.onmessage = refresh;
    }
    window.addEventListener('focus', refresh);
    return () => { channel.current?.close(); channel.current = null; window.removeEventListener('focus', refresh); };
  }, [reload]);
  async function commit(change: (next: TrainingData) => void, expected?: number): Promise<boolean> {
    if (locked.current || !dataRef.current) return false;
    locked.current = true; setBusy(true);
    try {
      const current = dataRef.current;
      if (expected !== undefined && current.revision !== expected) throw new ConflictError();
      const next = structuredClone(current); change(next);
      const saved = await saveData(next, current.revision);
      accept(saved); channel.current?.postMessage('updated'); return true;
    } catch (error) {
      if (error instanceof ConflictError) {
        try { accept(await loadData()); } catch (readError) { setLoadError(errorMessage(readError)); }
      }
      message.error(errorMessage(error)); return false;
    } finally { locked.current = false; setBusy(false); }
  }
  function navigate(next: Page) { setPage(next); window.scrollTo({ top: 0 }); }
  function openSettings(day: number, variant?: 'A' | 'B') {
    if (!data || busy) return;
    const leg = variant || data.legNext; setEditLeg(leg);
    const config = structuredClone(configFor(data, day, leg));
    setDraft(config); originalDraft.current = JSON.stringify(config); editRevision.current = data.revision; setEditDay(day);
  }
  function closeSettings() {
    if (busy) return;
    if (JSON.stringify(draft) === originalDraft.current) { setEditDay(null); return; }
    modal.confirm({ title: '放弃未保存的设置？', content: '已保存的动作与训练记录不会变化。', okText: '放弃修改', cancelText: '继续设置', onOk: () => setEditDay(null) });
  }
  async function persistSettings() {
    if (editDay === null || !data) return;
    const save = async () => {
      const ok = await commit(next => saveConfig(next, editDay, draft, editLeg), editRevision.current);
      if (ok) { setEditDay(null); message.success('动作与组数已保存'); }
    };
    const losesProgress = (editDay !== 2 || editLeg === data.legNext) && configFor(data, editDay, editLeg).some(item => (data.counts[item.id] || 0) > (draft.find(selected => selected.id === item.id)?.sets || 0));
    if (losesProgress) modal.confirm({ title: '调整本轮训练记录？', content: '删掉动作或减少目标组数，会同时减少这次已记的组数。以前的训练记录不受影响。', okText: '保存修改', cancelText: '返回设置', onOk: save });
    else await save();
  }
  async function addSet(id: string, amount: 1 | -1) {
    if (await commit(next => countSet(next, id, amount))) {
      const current = dataRef.current!, progress = totals(current, current.current);
      if (amount > 0 && progress.done === progress.target) message.success('目标已完成，可以结束本次训练了');
    }
  }
  async function endTraining() {
    if (await commit(next => finishSession(next))) {
      message.success(`已保存本次记录，下次练${splits[dataRef.current!.current].name}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  function renderCard(day: number) {
    if (!data) return null;
    const split = splits[day], config = activeExercises(data, day), progress = totals(data, day), current = day === data.current;
    return <article key={day} className={`split-card ${current ? 'current' : ''}`} data-day={day}>
      <header className="split-head"><div className="day-num">0{day + 1}</div><div className="split-heading"><h3>{split.name}{day === 2 && ` · ${data.legNext}`}</h3><div className="split-status">{current ? '本次训练' : day === (data.current + 1) % 4 ? '下一次训练' : '后续训练'}{config.length > 0 && ` · ${config.length} 个动作 / ${progress.target} 组`}</div></div><button className="settings-button" disabled={busy} onClick={() => openSettings(day)} aria-label={`设置${split.name}`}><Icon name="settings" />设置</button></header>
      {day === 2 && <div className="rotation-controls"><p>{current ? '本次' : '下次腿臀'}用 {data.legNext}，结束后自动换 {data.legNext === 'A' ? 'B' : 'A'}。两套动作和组数分别保存。</p><div><Button disabled={busy} onClick={() => openSettings(2, 'A')}>设置 A</Button><Button disabled={busy} onClick={() => openSettings(2, 'B')}>设置 B</Button><Button disabled={busy || (current && !!data.startedAt)} onClick={() => void commit(switchLeg)}>切换为 {data.legNext === 'A' ? 'B' : 'A'}</Button></div>{!config.length && <p>这套还没有动作，请先设置 {data.legNext}。</p>}{current && data.startedAt && <p>本次已经开始，结束后可手动切换。</p>}</div>}
      {(day === 1 || day === 3) && <div className="rotation-controls"><label>{day === 1 ? '胸部' : '腹部'}频率 <Select aria-label={day === 1 ? '胸部训练频率' : '腹部训练频率'} value={data.frequency[day === 1 ? 'chest' : 'abs']} disabled={busy || (current && !!data.startedAt)} options={[{ value: 'every', label: '每轮练' }, { value: 'alternate', label: '隔轮练' }]} onChange={value => void commit(next => setFrequency(next, day === 1 ? 'chest' : 'abs', value))} /></label><p>第 {roundFor(data, day)} 轮 · {data.frequency[day === 1 ? 'chest' : 'abs'] === 'alternate' && roundFor(data, day) % 2 === 0 ? `这轮不练${day === 1 ? '胸，肩部照常练' : '腹，手臂照常练'}，选好的动作会保留。` : '这轮照常练。'}隔轮练就是练一轮、休一轮，从第 1 轮开始。</p></div>}
      {split.note && <p className="split-guidance">{split.note}</p>}
      {config.length ? config.map(item => {
        const exercise = exercises.find(exercise => exercise.id === item.id)!, completed = data.counts[item.id] || 0;
        return <div className={`exercise-row ${completed >= item.sets ? 'done-row' : ''}`} key={item.id}><div className="exercise-info"><div className="exercise-name">{exercise.name}</div><div className="dots" aria-label={`已完成 ${completed} 组，目标 ${item.sets} 组`}>{Array.from({ length: item.sets }, (_, index) => <span key={index} className={`dot ${index < completed ? 'filled' : ''}`} aria-hidden="true" />)}<span className="exercise-count">{completed} / {item.sets}</span></div></div><button className="undo" aria-label={`撤销${exercise.name}一组`} disabled={!current || !completed || busy} onClick={() => void addSet(item.id, -1)}>−</button><button className="add" aria-label={`${exercise.name}完成一组`} disabled={!current || completed >= item.sets || busy} onClick={() => void addSet(item.id, 1)}>{completed >= item.sets ? '✓' : '+1'}</button></div>;
      }) : <div className="empty-card"><span className="empty-line" />还没选动作，点右上角「设置」开始</div>}
      {config.length > 0 && <div className="card-progress"><span style={{ width: `${progress.done / progress.target * 100}%` }} /></div>}
    </article>;
  }
  function renderTraining() {
    if (!data) return null;
    if (!data.chosen) return <div className="selection-wrap"><div className="eyebrow">FIND YOUR RHYTHM</div><h1>找到你的训练节奏。</h1><p className="intro">从一份好计划开始。选好动作，安排组数，<br />接下来，只需专注完成眼前这一组。</p><article className="plan-card" aria-label="当前推荐计划"><div className="plan-art"><div className="art-grid" /><span className="art-tag">THE FOUR-DAY SPLIT</span><div className="art-copy">练得有方向。<br />坚持有章法。<small>BUILD YOUR ROUTINE. MAKE IT YOURS.</small></div><div className="big-four" aria-hidden="true">04</div></div><div className="plan-info"><div className="plan-title"><h2>好人松松训练计划<br /><span className="plan-subtitle">四分化</span></h2><span className="selected-mark" aria-label="已选中"><Icon name="check" /></span></div><p className="sub">分四次练，按自己的节奏循环。</p><div className="split-chips">{splits.map(split => <span key={split.name}>{split.short}</span>)}</div><div className="plan-foot"><span>动作自由选择 · 组数灵活设置</span><span>01 / 01</span></div></div></article><div className="selection-bottom"><p>选好计划，再选每次要练的动作。</p><button className="primary" disabled={busy} onClick={() => void commit(next => { next.chosen = true; })}>选择这个计划，开始选动作 <Icon name="arrow" /></button></div><div className="page-foot"><span>当前推荐仅此一份计划</span><button className="text-button" onClick={() => setHelp(true)}>使用说明 ↗</button></div></div>;
    const current = data.current, progress = totals(data, current), complete = progress.target > 0 && progress.done === progress.target;
    return <><section className="overview"><div><div className="eyebrow">YOUR ROUTINE, YOUR PACE</div><h1>今天，也练好每一组。</h1><p className="sub">{PLAN_NAME}</p></div><div className="date">{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date())}</div></section><section className="summary"><div><div className="summary-label">第 {data.round} 轮 · DAY 0{current + 1}</div><h2>{splits[current].name}{current === 2 && ` · ${data.legNext}`}</h2><p>{!progress.target ? '先点下方「设置」，选好今天的动作。' : complete ? '目标已完成，给今天的坚持一个肯定。' : '做完一组，点一下 +1。'}</p></div><div><div className="summary-number"><strong>{progress.done}</strong><span>/ {progress.target} 组</span></div><div className="summary-next">下次 · {splits[(current + 1) % 4].short}</div></div></section><div className="section-head"><h2>当前训练</h2><span>按自己的节奏完成</span></div>{renderCard(current)}<div className="finish-panel"><p>{complete ? '练完了就收工，下次继续。' : progress.target ? `本次还剩 ${progress.target - progress.done} 组，也可以现在结束。` : '还没开始也可以结束，历史会标记为「未训练」。'}</p><button className="primary" onClick={() => void endTraining()} disabled={busy}>{busy ? '正在保存…' : '结束本次训练'}<Icon name="arrow" /></button></div><div className="section-head"><h2>其他分化</h2><span>按训练顺序排列</span></div><div className="split-grid">{[1, 2, 3].map(offset => renderCard((current + offset) % 4))}</div><div className="page-foot"><span>自动保存 · 换设备登录也能继续</span><button className="text-button" onClick={() => setHelp(true)}>使用说明 ↗</button></div></>;
  }
  function renderSession(session: Session) {
    const completed = session.exercises.reduce((sum, item) => sum + item.completed, 0), target = session.exercises.reduce((sum, item) => sum + item.target, 0);
    return <details className="history-card" key={session.id}><summary><span className="history-date">{session.date}<small>{new Date(session.endedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small></span><span className="history-title"><strong>{splits[session.day].name}{session.legVariant && ` · ${session.legVariant}`}</strong><small>{completed === 0 ? '未训练' : completed >= target ? '目标完成' : '提前结束'} · {completed} / {target} 组</small></span><span className="history-chevron">⌄</span></summary><div className="history-detail">{session.exercises.length ? session.exercises.map(item => <div key={item.id}><span>{item.name}</span><strong>{item.completed} / {item.target} 组</strong></div>) : <p>这次没有选动作。</p>}</div></details>;
  }
  function renderHistory() {
    if (!data) return null;
    const stats = statistics(data), filtered = data.history.filter(session => (historyDay === undefined || session.day === historyDay) && (!historyMonth || session.date.startsWith(historyMonth)));
    return <><div className="eyebrow">SMALL STEPS, REAL PROGRESS</div><h1>每一次坚持，都有迹可循。</h1><p className="intro">回看走过的路，继续积累下一组。</p><div className="stats-grid">{[['累计训练', stats.sessions, '次'], ['完成组数', stats.sets, '组'], ['训练天数', stats.days, '天']].map(([label, number, unit]) => <div className="stat-card" key={label}><span>{label}</span><strong>{number}<small>{unit}</small></strong></div>)}</div><p className="stat-note">练过至少一组，并点击「结束本次训练」，才会计入统计。</p><div className="split-stats">{splits.map((split, day) => { const sets = data.history.filter(session => session.day === day).reduce((sum, session) => sum + session.exercises.reduce((n, item) => n + item.completed, 0), 0); return <div key={day}><span>{split.name}</span><strong>{sets}<small> 组</small></strong></div>; })}</div><div className="section-head"><h2>训练记录</h2><span>{filtered.length} 次结束记录</span></div><div className="history-filters"><Select aria-label="按分化筛选" value={historyDay} onChange={value => { setHistoryDay(value); setHistoryLimit(10); }} allowClear placeholder="全部分化" options={splits.map((split, value) => ({ value, label: split.name }))} /><label>月份 <input type="month" value={historyMonth} onChange={event => { setHistoryMonth(event.target.value); setHistoryLimit(10); }} /></label>{historyMonth && <button className="text-button" onClick={() => setHistoryMonth('')}>清除月份</button>}</div>{filtered.length ? filtered.slice(0, historyLimit).map(renderSession) : <div className="empty-panel"><Empty description={data.history.length ? '当前条件下没有训练记录' : '结束第一次训练后，记录就会出现在这里'} /></div>}{filtered.length > historyLimit && <Button block onClick={() => setHistoryLimit(limit => limit + 10)}>查看更多记录</Button>}</>;
  }
  const navItems = [{ page: 'training' as const, name: '我的训练', icon: 'grid' as const }, { page: 'history' as const, name: '历史统计', icon: 'history' as const }];
  return <><div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-symbol"><Icon name="activity" /></span><div>练就<small>ONE SET AT A TIME</small></div></div><div className="sidebar-label">YOUR TRAINING SPACE</div><nav className="side-nav" aria-label="主导航">{navItems.map(item => <button key={item.page} className={page === item.page ? 'side-current' : 'side-link'} aria-current={page === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}><Icon name={item.icon} />{item.name}</button>)}</nav><div className="side-note"><strong>每一组，<br />都算数。</strong>少一点犹豫，多一点行动。<br />按照自己的节奏，慢慢变强。</div></aside><main className="content"><header className="topbar"><div className="breadcrumb">{navItems.find(item => item.page === page)?.name}<span> / </span>好人松松 · 四分化</div><div className="mobile-brand"><span className="brand-symbol"><Icon name="activity" /></span>练就</div><div className="account-actions"><span className="badge" title={username}><span className="account-name">{busy ? '正在保存' : username}</span></span><Button disabled={busy || logoutBusy} loading={logoutBusy} onClick={() => void onLogout?.()}>退出登录</Button></div></header>{loadError ? <Alert type="error" showIcon message="无法读取训练数据" description={`${loadError}。请检查网络后重试，已有记录不会被清空。`} action={<Button onClick={() => void reload()}>重试</Button>} /> : !data ? <div className="loading-panel"><Spin /><p>正在读取账号记录…</p></div> : page === 'training' ? <><PlanGuidance />{renderTraining()}</> : renderHistory()}</main></div><nav className="bottom-nav" aria-label="手机导航">{navItems.map(item => <button key={item.page} className={page === item.page ? 'active' : ''} aria-current={page === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}><Icon name={item.icon} />{item.name}</button>)}</nav>
    <Modal open={editDay !== null} onCancel={closeSettings} footer={null} closeIcon={null} width={720} className="settings-modal" destroyOnHidden title={null}>
      {editDay !== null && <div className="react-settings-layout"><header className="dialog-head"><button className="back" disabled={busy} onClick={closeSettings} aria-label="返回训练页"><Icon name="back" /></button><div><h2>设置 · {splits[editDay].name}{editDay === 2 && ` · 方案 ${editLeg}`}</h2><p>选择动作，安排适合自己的训练量</p></div></header><div className="dialog-body"><div className="info-strip">{editDay === 2 && <>正在设置 {editLeg}，另一套不会跟着改。返回后点「设置 A」或「设置 B」就能改另一套。<br /></>}推荐组数是这一类动作加起来的总数。选好动作后，可以分别调整组数，默认每个动作 4 组。{splits[editDay].note && <><br />{splits[editDay].note}</>}</div>{splits[editDay].groups.map(group => { const selected = draft.filter(item => group.items.some(exercise => exercise.id === item.id)); return <section className="group" key={group.name}><div className="group-title"><h3>{group.name}</h3><span className="recommend">推荐总量 {group.range}</span></div><p className="group-description">{group.hint}</p>{group.items.map(exercise => { const choice = draft.find(item => item.id === exercise.id); return <div className={`choice ${choice ? 'selected' : ''}`} key={exercise.id}><label><input type="checkbox" checked={!!choice} disabled={busy} onChange={event => setDraft(items => event.target.checked ? [...items, { id: exercise.id, sets: 4 }] : items.filter(item => item.id !== exercise.id))} />{exercise.name}</label>{choice && <div className="stepper"><button disabled={choice.sets <= 1 || busy} aria-label={`减少${exercise.name}组数`} onClick={() => setDraft(items => items.map(item => item.id === exercise.id ? { ...item, sets: item.sets - 1 } : item))}>−</button><output aria-label={`${exercise.name}目标组数`}>{choice.sets}</output><button disabled={choice.sets >= 20 || busy} aria-label={`增加${exercise.name}组数`} onClick={() => setDraft(items => items.map(item => item.id === exercise.id ? { ...item, sets: item.sets + 1 } : item))}>+</button><span className="unit">组</span></div>}</div>; })}<div className="group-total">已选 {selected.length} 个动作 · {selected.reduce((sum, item) => sum + item.sets, 0)} 组</div></section>; })}</div><footer className="dialog-footer"><div aria-live="polite"><strong>{draft.length} 个动作 · {draft.reduce((sum, item) => sum + item.sets, 0)} 组</strong><small>每个动作可设 1–20 组</small></div><button className="primary" disabled={busy} onClick={() => void persistSettings()}>保存并返回 <Icon name="check" /></button></footer></div>}
    </Modal>
    <Modal open={help} onCancel={() => setHelp(false)} footer={<Button type="primary" onClick={() => setHelp(false)}>知道了</Button>} title="怎么使用这份计划"><div className="help-body"><PlanGuidance /><h3>01 / 先选计划，再选动作</h3><p>选好计划，点「设置」选择动作和组数。例如推荐 8 组，可以选两个动作，各做 4 组。</p><h3>02 / 做完一组，点一次 +1</h3><p>当前训练始终置顶，短条代表目标组数。点 +1 记录，点 − 撤销误操作。每次记录都会自动保存。</p><h3>03 / 随时结束，按顺序继续</h3><p>不必做满目标即可结束训练。历史会保存当时的动作、目标和实际组数；零组结束会标记为「未训练」，不计入累计训练次数。顺序为背 → 胸 → 腿臀 → 大臂和腹，休息日由你安排。</p><h3>04 / 自动轮换</h3><p>腿臀 A、B 各设置一次，以后就会交替使用。点「结束本次训练」就会换到另一套，没练或没练完也一样。开始前可以手动切换，历史里能看到练的是哪套。胸和腹可以每轮练，也可以练一轮、休一轮；肩部和手臂照常练。背、胸肩、腿臀、大臂腹都走完一次，算一轮。</p><h3>05 / 记录与同步</h3><p>今天没结束的训练，明天还能接着记。下次再练同一部位时，组数从零开始，以前的记录仍然保留。换设备登录同一个账号，也能继续。</p></div></Modal>
  </>;
}

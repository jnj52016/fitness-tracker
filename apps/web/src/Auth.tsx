import { useEffect, useState } from 'react';
import { Alert, Button, Input, Spin } from 'antd';
import App from './App';
import { ApiError, request, setApiUser } from './data/storage';
type User = { id: number; username: string };
export default function Auth() {
  const [user, setUser] = useState<User>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const clear = () => { setApiUser(undefined); setUser(undefined); setPassword(''); };
    window.addEventListener('fitness-unauthorized', clear);
    request<User>('/me').then(value => { if (active) { setApiUser(value.id); setUser(value); } }).catch(error => { if (active && !(error instanceof ApiError && error.status === 401)) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener('fitness-unauthorized', clear); };
  }, []);
  async function submit() {
    setBusy(true); setError('');
    try { const value = await request<User>(register ? '/register' : '/login', 'POST', { username, password }); setApiUser(value.id); setUser(value); setPassword(''); }
    catch (error) { setError(error instanceof Error ? error.message : '连接失败，请稍后重试'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try { await request('/logout', 'POST', {}); setApiUser(undefined); setUser(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : '退出失败，请重试'); }
    finally { setBusy(false); }
  }
  if (loading) return <div className="loading-panel"><Spin /><p>正在确认登录状态…</p></div>;
  if (user) return <>{error && <Alert type="error" message={error} closable onClose={() => setError('')} />}<App key={user.id} username={user.username} onLogout={logout} logoutBusy={busy} /></>;
  return <main className="auth-page"><form className="auth-card" onSubmit={event => { event.preventDefault(); if (!busy) void submit(); }}><div className="eyebrow">ONE SET AT A TIME</div><h1>练就</h1><h2>{register ? '创建账号' : '登录你的训练空间'}</h2><p>用同一个账号，在不同设备继续训练。</p>{error && <Alert type="error" showIcon message={error} />}<label htmlFor="username">用户名</label><Input id="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" placeholder="3–32 位字母、数字或下划线" value={username} onChange={e => setUsername(e.target.value)} /><label htmlFor="password">密码</label><Input.Password id="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} placeholder="8–128 位密码" value={password} onChange={e => setPassword(e.target.value)} /><Button type="primary" htmlType="submit" size="large" block loading={busy}>{register ? '注册并登录' : '登录'}</Button><Button type="link" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>{register ? '已有账号，去登录' : '没有账号？注册'}</Button><p className="small-note">无需手机号或邮箱。请妥善保管密码，暂不提供自助找回。</p></form></main>;
}

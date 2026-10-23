import { validateData, type TrainingData } from './model';
export class ConflictError extends Error {
  constructor() { super('另一台设备或页面刚修改了记录，已为你刷新。请重新操作；如果正在设置动作，请关掉设置后再打开'); }
}
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
let userId: number | undefined;
export function setApiUser(id: number | undefined) { userId = id; }
export async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/fitness-tracker/api${path}`, {
    method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(userId === undefined ? {} : { 'X-User-Id': String(userId) }) },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000),
  });
  const value = await response.json().catch(() => ({ message: '后端响应异常，请检查服务是否启动' }));
  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && path !== '/register') window.dispatchEvent(new Event('fitness-unauthorized'));
    if (response.status === 409 && path === '/data') throw new ConflictError();
    throw new ApiError(value.message || '请求失败，请重试', response.status);
  }
  return value as T;
}
export async function loadData(): Promise<TrainingData> { return validateData(await request('/data')); }
export async function saveData(data: TrainingData, expectedRevision: number): Promise<TrainingData> {
  return validateData(await request('/data', 'PUT', { data: validateData(data), expectedRevision }));
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialData } from './model';
import { ConflictError, loadData, request, saveData, setApiUser } from './storage';
afterEach(() => { vi.unstubAllGlobals(); setApiUser(undefined); });
describe('后端存储客户端', () => {
  it('携带账号身份和版本，成功后采用服务器版本', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...initialData(), revision: 1 })));
    vi.stubGlobal('fetch', fetcher); setApiUser(7);
    const saved = await saveData(initialData(), 0);
    expect(saved.revision).toBe(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('/fitness-tracker/api/data');
    expect(options.headers['X-User-Id']).toBe('7');
    expect(options.credentials).toBe('same-origin');
    expect(JSON.parse(options.body).expectedRevision).toBe(0);
  });
  it('冲突抛出专用错误，断网不回退到本地保存', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 409 })).mockRejectedValueOnce(new Error('网络不可用')));
    await expect(saveData(initialData(), 0)).rejects.toBeInstanceOf(ConflictError);
    await expect(saveData(initialData(), 0)).rejects.toThrow('网络不可用');
  });
  it('会话失效通知登录页；输错密码不触发账号清理', async () => {
    const handler = vi.fn(); window.addEventListener('fitness-unauthorized', handler);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('{"message":"需要登录"}', { status: 401 }))));
    await expect(request('/login', 'POST', {})).rejects.toThrow('需要登录'); expect(handler).not.toHaveBeenCalled();
    await expect(loadData()).rejects.toThrow('需要登录'); expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('fitness-unauthorized', handler);
  });
});

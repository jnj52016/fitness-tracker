// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Auth from './Auth';
vi.mock('./App', () => ({ default: ({ username, onLogout }: { username: string; onLogout: () => void }) => <div>当前用户：{username}<button onClick={onLogout}>退出登录</button></div> }));
beforeAll(() => { Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('未登录显示表单，错误密码可重试，注册登录后退出清理账号', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response('{"message":"登录已失效"}', { status: 401 }))
    .mockResolvedValueOnce(new Response('{"message":"用户名或密码不正确"}', { status: 401 }))
    .mockResolvedValueOnce(new Response('{"id":1,"username":"alice"}'))
    .mockResolvedValueOnce(new Response('{"ok":true}'));
  vi.stubGlobal('fetch', fetcher);
  render(<Auth />);
  await screen.findByRole('button', { name: '登 录' });
  expect(screen.queryByText('登录已失效')).toBeNull();
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } });
  fireEvent.submit(document.querySelector('form')!);
  await screen.findByText('用户名或密码不正确');
  fireEvent.click(screen.getByRole('button', { name: '没有账号？注册' }));
  fireEvent.submit(document.querySelector('form')!);
  await screen.findByText('当前用户：alice');
  expect(fetcher.mock.calls[2][0]).toBe('/fitness-tracker/api/register');
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
  await screen.findByLabelText('用户名');
  expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('');
});

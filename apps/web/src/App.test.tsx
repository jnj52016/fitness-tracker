// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App as AntApp, ConfigProvider } from 'antd';
import App from './App';
import { initialData } from './data/model';
import { loadData, saveData } from './data/storage';
import * as storage from './data/storage';

vi.mock('./data/storage', async () => ({ ...await import('./data/legacyStorage') }));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }) });
  window.scrollTo = vi.fn();
  const computed = window.getComputedStyle;
  window.getComputedStyle = element => computed(element);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('BroadcastChannel', class { postMessage() {} close() {} onmessage = null; });
});
beforeEach(async () => {
  const current = await loadData();
  await saveData(initialData(), current.revision);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount() {
  return render(<ConfigProvider theme={{ token: { motion: false } }}><AntApp><App /></AntApp></ConfigProvider>);
}
describe('React 页面流程', () => {
  it('选择、设置、加组、重新挂载恢复、提前结束与历史', async () => {
    let view = mount();
    fireEvent.click(await screen.findByRole('button', { name: /选择这个计划/ }));
    fireEvent.click(await screen.findByRole('button', { name: '设置背 + 肩后束' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '引体向上' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存并返回' }));
    const add = await screen.findByRole('button', { name: '引体向上完成一组' });
    await waitFor(() => expect(add.hasAttribute('disabled')).toBe(false));
    fireEvent.click(add);
    await waitFor(async () => expect((await loadData()).counts['0-0-0']).toBe(1));
    view.unmount(); view = mount();
    await screen.findByRole('button', { name: '引体向上完成一组' });
    expect(screen.getByLabelText('已完成 1 组，目标 4 组')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '结束本次训练' }));
    await waitFor(async () => expect((await loadData()).history).toHaveLength(1));
    await waitFor(() => expect(document.querySelector('.split-card')?.getAttribute('data-day')).toBe('1'));
    fireEvent.click(screen.getAllByRole('button', { name: '历史统计' })[0]);
    await screen.findByText('提前结束 · 1 / 4 组');
    view.unmount();
  }, 15000);
  it('保存失败明确提示，不推进页面或伪造保存结果', async () => {
    mount();
    const choose = await screen.findByRole('button', { name: /选择这个计划/ });
    vi.spyOn(storage, 'saveData').mockRejectedValueOnce(new Error('网络连接中断，保存失败'));
    fireEvent.click(choose);
    await screen.findByText('网络连接中断，保存失败');
    expect(screen.getByRole('button', { name: /选择这个计划/ })).toBeTruthy();
    expect((await loadData()).chosen).toBe(false);
  });
});

it('腿臀分别设置 A/B，切换与重新挂载后保留独立配置', async () => {
  const seed = initialData(); seed.chosen = true; seed.current = 2;
  await saveData(seed, (await loadData()).revision);
  let view = mount();
  fireEvent.click(await screen.findByRole('button', { name: '设置 A' }));
  let dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '杠铃深蹲' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '保存并返回' }));
  await waitFor(async () => expect((await loadData()).configs[2]).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '设置 B' }));
  dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '器械腿弯举' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '保存并返回' }));
  await waitFor(async () => expect((await loadData()).legB).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '切换为 B' }));
  await screen.findByRole('button', { name: '器械腿弯举完成一组' });
  view.unmount(); view = mount();
  const add = await screen.findByRole('button', { name: '器械腿弯举完成一组' });
  fireEvent.click(add);
  await waitFor(async () => expect((await loadData()).counts['2-1-1']).toBe(1));
  expect(screen.getByRole('button', { name: '切换为 A' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '结束本次训练' }));
  await waitFor(async () => expect((await loadData()).history[0].legVariant).toBe('B'));
  expect((await loadData()).legNext).toBe('A');
  view.unmount();
});

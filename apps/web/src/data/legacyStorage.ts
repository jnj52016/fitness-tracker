import { initialData, validateData, type TrainingData } from './model';

const DB_NAME = 'fitness-tracker';
const STORE = 'training';
let connection: Promise<IDBDatabase> | undefined;
export class ConflictError extends Error {
  constructor() { super('数据已在另一页面更新，已重新加载。请重试；若正在设置或导入，请取消后重新打开'); }
}
function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(new Error('请先关闭此应用的其他标签页，再重试')); };
  });
  return connection;
}
export async function loadData(): Promise<TrainingData> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get('state');
    let value: TrainingData;
    let validationError: unknown;
    request.onsuccess = () => { try { value = request.result === undefined ? initialData() : validateData(request.result); } catch (error) { validationError = error; } };
    transaction.oncomplete = () => validationError ? reject(validationError) : resolve(value);
    transaction.onabort = () => reject(transaction.error || new Error('读取本地数据失败'));
    transaction.onerror = () => reject(transaction.error);
  });
}
/** Revision check and write share one readwrite transaction to avoid cross-tab lost updates. */
export async function saveData(data: TrainingData, expectedRevision: number): Promise<TrainingData> {
  const value = validateData({ ...data, revision: expectedRevision + 1 });
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    let failure: Error | null = null;
    const request = store.get('state');
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== expectedRevision) {
        failure = new ConflictError(); transaction.abort(); return;
      }
      store.put(value, 'state');
    };
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => reject(failure || transaction.error || new Error('本地保存失败，可能是存储空间不足'));
    transaction.onerror = () => reject(transaction.error);
  });
}

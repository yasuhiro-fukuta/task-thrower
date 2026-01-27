import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebaseClient";

export type Task = {
  id: string;
  uid: string;
  title: string;
  dueDate: string; // YYYY-MM-DD
  removed: boolean;
  doneCount: number;
  // 最終完了日 (YYYY-MM-DD) / 未設定なら空文字
  lastDoneDate: string;
  // 投げ回数
  throwCount: number;
  // ソート順（1〜24）
  sortOrder: number;
  sorter: number;
  createdAtMs: number;
  updatedAtMs: number;
};

function str(v: any): string {
  return String(v ?? "").trim();
}
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function bool(v: any): boolean {
  return !!v;
}

function uniq(ids: string[]) {
  return Array.from(new Set(ids.map((x) => String(x)).filter(Boolean)));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function createTask(args: {
  uid: string;
  title: string;
  dueDate: string;
  sortOrder: number;
  sorter: number;
}) {
  const now = Date.now();
  const uid = str(args.uid);
  const title = str(args.title);
  const dueDate = str(args.dueDate);
  const sortOrderRaw = num(args.sortOrder);
  const sorter = num(args.sorter) || now;

  if (!uid) throw new Error("uid is required");
  if (!title) throw new Error("title is required");
  if (!dueDate) throw new Error("dueDate is required");

  const sortOrder = Math.min(24, Math.max(1, Math.trunc(sortOrderRaw || 24)));

  const ref = await addDoc(collection(db, "tasks"), {
    schemaVersion: 1,
    uid,
    title,
    dueDate,
    removed: false,
    doneCount: 0,
    lastDoneDate: "",
    throwCount: 0,
    sortOrder,
    sorter,
    createdAtMs: now,
    updatedAtMs: now,
  });

  return ref.id;
}

export async function listTasks(uid: string): Promise<Task[]> {
  const q = query(collection(db, "tasks"), where("uid", "==", uid));
  const snap = await getDocs(q);

  return snap.docs.map((d) => {
    const data: any = d.data();

    const createdAtMs = num(data?.createdAtMs) || 0;
    const updatedAtMs = num(data?.updatedAtMs) || createdAtMs || 0;

    const dueDate = str(data?.dueDate) || "9999-12-31";
    const removed = bool(data?.removed);
    const doneCount = Math.max(0, num(data?.doneCount));
    const lastDoneDate = str(data?.lastDoneDate);
    const throwCount = Math.max(0, num(data?.throwCount));
    let sorter = num(data?.sorter);

    // ソート順（1〜24）: ない場合は sorter から雑に推定して末尾寄せ
    let sortOrder = Math.trunc(num(data?.sortOrder));

    if (!Number.isFinite(sorter) || sorter <= 0) sorter = createdAtMs || updatedAtMs || 0;

    if (!Number.isFinite(sortOrder) || sortOrder < 1 || sortOrder > 24) {
      const derived = Math.round((sorter || 0) / 1000);
      sortOrder = Math.min(24, Math.max(1, Math.trunc(derived || 24)));
    }

    return {
      id: d.id,
      uid: str(data?.uid),
      title: str(data?.title),
      dueDate,
      removed,
      doneCount,
      lastDoneDate,
      throwCount,
      sortOrder,
      sorter,
      createdAtMs,
      updatedAtMs,
    };
  });
}

async function batchUpdate(
  updates: { id: string; data: Record<string, any> }[],
  now: number
) {
  const batches = chunk(updates, 450);
  for (const part of batches) {
    const b = writeBatch(db);
    for (const u of part) {
      b.update(doc(db, "tasks", u.id), { ...u.data, updatedAtMs: now });
    }
    await b.commit();
  }
}

export async function setDueDate(taskIds: string[], dueDate: string) {
  const ids = uniq(taskIds);
  if (!ids.length) return;

  const now = Date.now();
  await batchUpdate(ids.map((id) => ({ id, data: { dueDate } })), now);
}

export async function setRemoved(taskIds: string[], removed: boolean) {
  const ids = uniq(taskIds);
  if (!ids.length) return;

  const now = Date.now();
  await batchUpdate(ids.map((id) => ({ id, data: { removed } })), now);
}

export async function incrementDoneCount(taskIds: string[], delta = 1) {
  const ids = uniq(taskIds);
  if (!ids.length) return;

  const now = Date.now();
  await batchUpdate(
    ids.map((id) => ({ id, data: { doneCount: increment(delta) } })),
    now
  );
}

export async function incrementThrowCount(taskIds: string[], delta = 1) {
  const ids = uniq(taskIds);
  if (!ids.length) return;

  const now = Date.now();
  await batchUpdate(
    ids.map((id) => ({ id, data: { throwCount: increment(delta) } })),
    now
  );
}

// 完了：doneCount +1 & lastDoneDate を更新（必要なら throwCount も +1）
export async function completeTasks(
  taskIds: string[],
  lastDoneDate: string,
  options?: { throwDelta?: number; doneDelta?: number }
) {
  const ids = uniq(taskIds);
  if (!ids.length) return;

  const doneDelta = options?.doneDelta ?? 1;
  const throwDelta = options?.throwDelta ?? 0;

  const data: Record<string, any> = {
    doneCount: increment(doneDelta),
    lastDoneDate,
  };
  if (throwDelta) data.throwCount = increment(throwDelta);

  const now = Date.now();
  await batchUpdate(ids.map((id) => ({ id, data })), now);
}

// 期限変更：dueDate を更新（必要なら throwCount も +1）
export async function rescheduleTasks(
  taskIds: string[],
  dueDate: string,
  options?: { throwDelta?: number }
) {
  const ids = uniq(taskIds);
  if (!ids.length) return;

  const throwDelta = options?.throwDelta ?? 0;
  const data: Record<string, any> = { dueDate };
  if (throwDelta) data.throwCount = increment(throwDelta);

  const now = Date.now();
  await batchUpdate(ids.map((id) => ({ id, data })), now);
}

// 期限変更（個別日付版）：各タスクに異なる dueDate を設定（必要なら throwCount も +1）
export async function rescheduleTasksIndividually(
  items: { id: string; dueDate: string }[],
  options?: { throwDelta?: number }
) {
  const map = new Map<string, string>();
  for (const it of items || []) {
    const id = str((it as any)?.id);
    const dueDate = str((it as any)?.dueDate);
    if (!id || !dueDate) continue;
    map.set(id, dueDate);
  }

  const rows = Array.from(map.entries()).map(([id, dueDate]) => ({ id, dueDate }));
  if (!rows.length) return;

  const throwDelta = options?.throwDelta ?? 0;
  const now = Date.now();
  await batchUpdate(
    rows.map((r) => ({
      id: r.id,
      data: {
        dueDate: r.dueDate,
        ...(throwDelta ? { throwCount: increment(throwDelta) } : {}),
      },
    })),
    now
  );
}

// 除去：removed を更新（必要なら throwCount も +1）
export async function removeTasks(
  taskIds: string[],
  removed: boolean,
  options?: { throwDelta?: number }
) {
  const ids = uniq(taskIds);
  if (!ids.length) return;

  const throwDelta = options?.throwDelta ?? 0;
  const data: Record<string, any> = { removed };
  if (throwDelta) data.throwCount = increment(throwDelta);

  const now = Date.now();
  await batchUpdate(ids.map((id) => ({ id, data })), now);
}

export async function updateSorters(items: { id: string; sorter: number }[]) {
  const rows = items
    .map((x) => ({ id: String(x.id), sorter: num(x.sorter) }))
    .filter((x) => x.id && Number.isFinite(x.sorter));

  if (!rows.length) return;

  const now = Date.now();
  await batchUpdate(rows.map((r) => ({ id: r.id, data: { sorter: r.sorter } })), now);
}

// 並び替え用：sorter と sortOrder を一括更新
export async function updateOrdering(
  items: { id: string; sorter: number; sortOrder: number }[]
) {
  const rows = items
    .map((x) => ({
      id: String(x.id),
      sorter: num(x.sorter),
      sortOrder: Math.min(24, Math.max(1, Math.trunc(num(x.sortOrder) || 24))),
    }))
    .filter((x) => x.id && Number.isFinite(x.sorter));

  if (!rows.length) return;

  const now = Date.now();
  await batchUpdate(
    rows.map((r) => ({
      id: r.id,
      data: { sorter: r.sorter, sortOrder: r.sortOrder },
    })),
    now
  );
}

export async function updateTask(id: string, data: Record<string, any>) {
  const taskId = str(id);
  if (!taskId) return;

  const now = Date.now();
  await batchUpdate([{ id: taskId, data }], now);
}

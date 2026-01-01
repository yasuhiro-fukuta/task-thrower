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
  sorter: number;
}) {
  const now = Date.now();
  const uid = str(args.uid);
  const title = str(args.title);
  const dueDate = str(args.dueDate);
  const sorter = num(args.sorter) || now;

  if (!uid) throw new Error("uid is required");
  if (!title) throw new Error("title is required");
  if (!dueDate) throw new Error("dueDate is required");

  const ref = await addDoc(collection(db, "tasks"), {
    schemaVersion: 1,
    uid,
    title,
    dueDate,
    removed: false,
    doneCount: 0,
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
    let sorter = num(data?.sorter);

    if (!Number.isFinite(sorter) || sorter <= 0) sorter = createdAtMs || updatedAtMs || 0;

    return {
      id: d.id,
      uid: str(data?.uid),
      title: str(data?.title),
      dueDate,
      removed,
      doneCount,
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

export async function updateSorters(items: { id: string; sorter: number }[]) {
  const rows = items
    .map((x) => ({ id: String(x.id), sorter: num(x.sorter) }))
    .filter((x) => x.id && Number.isFinite(x.sorter));

  if (!rows.length) return;

  const now = Date.now();
  await batchUpdate(rows.map((r) => ({ id: r.id, data: { sorter: r.sorter } })), now);
}

export async function updateTask(id: string, data: Record<string, any>) {
  const taskId = str(id);
  if (!taskId) return;

  const now = Date.now();
  await batchUpdate([{ id: taskId, data }], now);
}

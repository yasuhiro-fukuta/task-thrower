"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";

import AuthModal from "@/components/AuthModal";
import { auth } from "@/lib/firebaseClient";
import { addDaysISO, formatYYMMDD, todayISO } from "@/lib/dateOnly";
import {
  createTask,
  listTasks,
  setDueDateAndThrow,
  removeAndThrow,
  setRemoved,
  doneWithDate,
  doneWithDateAndThrow,
  updateTask,
  updateTodayOrdering,
  updateSortOrder,
  type Task,
} from "@/lib/taskStore";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type TabKey = "today" | "future" | "removed";

type ThrowAction =
  | "TOMORROW"
  | "DAY_AFTER"
  | "WEEK"
  | "MONTH"
  | "MONTH3"
  | "YEAR"
  | "DONE"
  | "REMOVE";

function actionToDays(a: ThrowAction): number | null {
  switch (a) {
    case "TOMORROW":
      return 1;
    case "DAY_AFTER":
      return 2;
    case "WEEK":
      return 7;
    case "MONTH":
      return 30;
    case "MONTH3":
      return 90;
    case "YEAR":
      return 365;
    case "DONE":
    case "REMOVE":
      return null;
  }
}

function clampSortOrder(v: number): number {
  return Math.min(24, Math.max(1, v));
}

function stopDragStart(e: React.SyntheticEvent) {
  e.stopPropagation();
}

function SortOrderSelect(props: {
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const { value, disabled, onChange } = props;
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
      onPointerDownCapture={stopDragStart}
      onTouchStartCapture={stopDragStart}
      onMouseDownCapture={stopDragStart}
    >
      {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

function SortableTaskRow(props: {
  task: Task;
  busy: boolean;
  checked: boolean;
  onToggle: () => void;
  onTomorrow: () => void;
  onDone: () => void;
  onRemove: () => void;
  onSortOrderChange: (v: number) => void;
}) {
  const { task, busy, checked, onToggle, onTomorrow, onDone, onRemove, onSortOrderChange } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1,
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        "rounded-lg border px-3 py-2 text-sm",
        "border-neutral-800 bg-neutral-950",
        isDragging ? "ring-2 ring-neutral-600" : "",
      ].join(" ")}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-2">
        <SortOrderSelect value={task.sortOrder} disabled={busy} onChange={onSortOrderChange} />

        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={busy}
          onPointerDownCapture={stopDragStart}
          onTouchStartCapture={stopDragStart}
          onMouseDownCapture={stopDragStart}
        />

        <div className="flex-1">{task.title}</div>

        {/* 完了回数表示（1回以上） */}
        {task.doneCount >= 1 && (
          <div
            className="text-xs text-neutral-400"
            onPointerDownCapture={stopDragStart}
            onTouchStartCapture={stopDragStart}
            onMouseDownCapture={stopDragStart}
          >
            完了*{task.doneCount}
          </div>
        )}

        <button
          type="button"
          onClick={onTomorrow}
          disabled={busy}
          className="rounded border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-50"
          onPointerDownCapture={stopDragStart}
          onTouchStartCapture={stopDragStart}
          onMouseDownCapture={stopDragStart}
        >
          明日へ
        </button>

        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="rounded border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-50"
          onPointerDownCapture={stopDragStart}
          onTouchStartCapture={stopDragStart}
          onMouseDownCapture={stopDragStart}
        >
          完了
        </button>

        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="rounded border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-50"
          onPointerDownCapture={stopDragStart}
          onTouchStartCapture={stopDragStart}
          onMouseDownCapture={stopDragStart}
        >
          除去
        </button>
      </div>
    </li>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={[
        "px-3 py-2 text-sm rounded-t-lg border",
        props.active
          ? "border-neutral-700 bg-neutral-900 text-neutral-100"
          : "border-transparent bg-transparent text-neutral-400 hover:text-neutral-200",
      ].join(" ")}
      type="button"
    >
      {props.children}
    </button>
  );
}

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const [baseDate, setBaseDate] = useState<string>(() => todayISO());
  const [tab, setTab] = useState<TabKey>("today");

  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [newSortOrder, setNewSortOrder] = useState<number>(24);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [throwAction, setThrowAction] = useState<ThrowAction>("TOMORROW");

  const [msg, setMsg] = useState<string | null>(null);
  const toast = (s: string) => {
    setMsg(s);
    setTimeout(() => setMsg(null), 1200);
  };

  const refresh = async (u: User) => {
    const list = await listTasks(u.uid);
    setAllTasks(list);
  };

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setSelected({});
      if (u) await refresh(u);
      else setAllTasks([]);
    });
  }, []);

  useEffect(() => {
    setSelected({});
  }, [baseDate]);

  const activeTasks = useMemo(() => allTasks.filter((t) => !t.removed), [allTasks]);

  // 今日：dueDate <= baseDate
  const todayTasks = useMemo(() => {
    return activeTasks
      .filter((t) => t.dueDate <= baseDate)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        if (a.sorter !== b.sorter) return (a.sorter || 0) - (b.sorter || 0);
        return (a.createdAtMs || 0) - (b.createdAtMs || 0);
      });
  }, [activeTasks, baseDate]);

  // 未来：dueDate > baseDate
  const futureTasks = useMemo(() => {
    return activeTasks
      .filter((t) => t.dueDate > baseDate)
      .sort((a, b) => {
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return (a.createdAtMs || 0) - (b.createdAtMs || 0);
      });
  }, [activeTasks, baseDate]);

  // 廃棄済
  const removedTasks = useMemo(() => {
    return allTasks
      .filter((t) => t.removed)
      .sort((a, b) => {
        if (a.dueDate !== b.dueDate) return b.dueDate.localeCompare(a.dueDate);
        return (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
      });
  }, [allTasks]);

  useEffect(() => {
    const ids = new Set(todayTasks.map((t) => t.id));
    setSelected((prev) => {
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v && ids.has(k)) next[k] = true;
      }
      return next;
    });
  }, [todayTasks]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  const toggle = (id: string) => setSelected((prev) => ({ ...prev, [id]: !prev[id] }));

  const nextSorter = () => {
    const so = clampSortOrder(newSortOrder);
    const max = todayTasks
      .filter((t) => t.sortOrder === so)
      .reduce((acc, t) => Math.max(acc, t.sorter || 0), 0);
    return (max || 0) + 1000;
  };

  // 追加：dueDate=baseDate, sortOrder=newSortOrder
  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    if (!user) return setAuthOpen(true);

    setBusy(true);
    try {
      await createTask({
        uid: user.uid,
        title: t,
        dueDate: baseDate,
        sortOrder: clampSortOrder(newSortOrder),
        sorter: nextSorter(),
      });
      setTitle("");
      await refresh(user);
      toast("追加");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "追加失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 個別：明日へ（throwCount+1）
  const onTomorrow = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      const target = addDaysISO(baseDate, 1);
      await setDueDateAndThrow([id], target);
      await refresh(user);
      toast("明日へ");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "更新失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 個別：完了（doneCount+1 & lastDoneDate=baseDate）
  const onDone = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      await doneWithDate([id], baseDate);
      await refresh(user);
      toast("完了+1");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "完了失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 個別：除去（throwCountは増やさない）
  const onRemove = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      await setRemoved([id], true);
      await refresh(user);
      toast("除去");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "除去失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 今日タスクの sortOrder 変更（即並び替え）
  const onSortOrderChange = async (task: Task, newValue: number) => {
    if (!user) return setAuthOpen(true);
    const so = clampSortOrder(newValue);

    setBusy(true);
    try {
      const max = todayTasks
        .filter((t) => t.id !== task.id && t.sortOrder === so)
        .reduce((acc, t) => Math.max(acc, t.sorter || 0), 0);
      const sorter = (max || 0) + 1000;

      await updateSortOrder(task.id, so, sorter);
      await refresh(user);
      toast("順変更");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "順変更失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 未来→戻し：dueDate=baseDate, sorter再付与
  const onBackFromFuture = async (task: Task) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      const so = clampSortOrder(task.sortOrder || 24);
      const max = todayTasks
        .filter((t) => t.sortOrder === so)
        .reduce((acc, t) => Math.max(acc, t.sorter || 0), 0);
      await updateTask(task.id, { dueDate: baseDate, sorter: (max || 0) + 1000 });
      await refresh(user);
      toast("戻し");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "戻し失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 廃棄済→戻し：dueDate=baseDate, removed=false
  const onBackFromRemoved = async (task: Task) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      const so = clampSortOrder(task.sortOrder || 24);
      const max = todayTasks
        .filter((t) => t.sortOrder === so)
        .reduce((acc, t) => Math.max(acc, t.sorter || 0), 0);
      await updateTask(task.id, { dueDate: baseDate, removed: false, sorter: (max || 0) + 1000 });
      await refresh(user);
      toast("復帰");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "復帰失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 投げる（一括）
  const onThrow = async () => {
    if (!user) return setAuthOpen(true);
    if (selectedIds.length === 0) return;

    setBusy(true);
    try {
      if (throwAction === "DONE") {
        await doneWithDateAndThrow(selectedIds, baseDate);
        toast("完了+1");
      } else if (throwAction === "REMOVE") {
        await removeAndThrow(selectedIds);
        toast("除去");
      } else {
        const days = actionToDays(throwAction)!;
        const target = addDaysISO(baseDate, days);
        await setDueDateAndThrow(selectedIds, target);
        toast(`投げた→${target}`);
      }

      setSelected({});
      await refresh(user);
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "投げる失敗"));
    } finally {
      setBusy(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // スマホ：長押し開始（スクロール優先、かつテキスト選択を回避）
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } })
  );

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!active?.id || !over?.id) return;
    if (active.id === over.id) return;
    if (!user) return setAuthOpen(true);

    const ids = todayTasks.map((t) => t.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const moved = arrayMove(todayTasks, oldIndex, newIndex);

    // ドロップ位置に応じて sortOrder を自動変更
    const movedTask = moved[newIndex];
    let newSO = movedTask.sortOrder;

    const prev = moved[newIndex - 1];
    const next = moved[newIndex + 1];

    if (prev) newSO = prev.sortOrder; // 「6と7の間→6」
    else if (next) newSO = next.sortOrder;

    newSO = clampSortOrder(newSO);

    // 最終配列に対して、sortOrderごとに sorter を振り直し
    const counter = new Map<number, number>();
    const updates = moved.map((t) => {
      const so = t.id === movedTask.id ? newSO : t.sortOrder;
      const current = counter.get(so) ?? 0;
      const nextSorter = current + 1000;
      counter.set(so, nextSorter);
      return { id: t.id, sortOrder: so, sorter: nextSorter };
    });

    setBusy(true);
    try {
      // 先にローカル反映
      const m = new Map(updates.map((u) => [u.id, u]));
      setAllTasks((prevAll) =>
        prevAll.map((t) => {
          const u = m.get(t.id);
          return u ? { ...t, sortOrder: u.sortOrder, sorter: u.sorter } : t;
        })
      );

      await updateTodayOrdering(updates);
      toast("並び替え");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "並び替え失敗"));
      await refresh(user);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl p-6 text-neutral-100">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-xl font-semibold">Task Thrower</div>

          <div className="mt-2">
            <input
              type="date"
              value={baseDate}
              onChange={(e) => setBaseDate(e.target.value)}
              className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm"
              disabled={busy}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <div className="text-xs text-neutral-300">{user.displayName || user.email}</div>
              <button
                onClick={() => signOut(auth)}
                className="rounded-md border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900 disabled:opacity-50"
                disabled={busy}
              >
                ログアウト
              </button>
            </>
          ) : (
            <button
              onClick={() => setAuthOpen(true)}
              className="rounded-md border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-900"
            >
              ログイン
            </button>
          )}
        </div>
      </header>

      <form onSubmit={onAdd} className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="text-xs text-neutral-400">順</div>
          <select
            value={newSortOrder}
            onChange={(e) => setNewSortOrder(Number(e.target.value))}
            className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm"
            disabled={busy}
          >
            {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タスクを追加（Enter）→ 左上日付"
          className="flex-1 min-w-[240px] rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-700"
          disabled={busy}
        />
        <button
          type="submit"
          className="rounded-md border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-50"
          disabled={busy}
        >
          追加
        </button>
      </form>

      {/* Tabs */}
      <div className="mt-6 flex items-end gap-1 border-b border-neutral-800">
        <TabButton active={tab === "today"} onClick={() => setTab("today")}>
          今日のタスク
        </TabButton>
        <TabButton active={tab === "future"} onClick={() => setTab("future")}>
          未来のタスク
        </TabButton>
        <TabButton active={tab === "removed"} onClick={() => setTab("removed")}>
          廃棄済
        </TabButton>
        <div className="ml-auto text-xs text-neutral-500 pb-2">選択中: {selectedIds.length}</div>
      </div>

      {/* Today */}
      {tab === "today" && (
        <section className="rounded-b-xl border border-t-0 border-neutral-800 p-4">
          {todayTasks.length === 0 ? (
            <div className="text-sm text-neutral-500">空</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={todayTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {todayTasks.map((t) => (
                    <SortableTaskRow
                      key={t.id}
                      task={t}
                      busy={busy}
                      checked={!!selected[t.id]}
                      onToggle={() => toggle(t.id)}
                      onTomorrow={() => onTomorrow(t.id)}
                      onDone={() => onDone(t.id)}
                      onRemove={() => onRemove(t.id)}
                      onSortOrderChange={(v) => onSortOrderChange(t, v)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {/* 投げる */}
          <div className="mt-5 border-t border-neutral-800 pt-4">
            <div className="text-sm font-medium">投げ先</div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {[
                ["TOMORROW", "明日"],
                ["DAY_AFTER", "明後日"],
                ["WEEK", "1週間"],
                ["MONTH", "1ヶ月"],
                ["MONTH3", "3か月"],
                ["YEAR", "1年"],
                ["DONE", "完了"],
                ["REMOVE", "除去"],
              ].map(([v, label]) => (
                <label key={v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="throwAction"
                    value={v}
                    checked={throwAction === (v as ThrowAction)}
                    onChange={() => setThrowAction(v as ThrowAction)}
                    disabled={busy}
                  />
                  {label}
                </label>
              ))}
            </div>

            <button
              onClick={onThrow}
              disabled={busy || selectedIds.length === 0}
              className="mt-3 rounded-md border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-50"
            >
              投げる
            </button>

            <div className="mt-2 text-xs text-neutral-500">※チェック→投げ先→投げる</div>
          </div>
        </section>
      )}

      {/* Future */}
      {tab === "future" && (
        <section className="rounded-b-xl border border-t-0 border-neutral-800 p-4">
          {futureTasks.length === 0 ? (
            <div className="text-sm text-neutral-500">空</div>
          ) : (
            <ul className="space-y-2">
              {futureTasks.map((t) => (
                <li key={t.id} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">{t.title}</div>
                    <div className="text-xs text-neutral-400">({formatYYMMDD(t.dueDate)})</div>
                    <button
                      type="button"
                      onClick={() => onBackFromFuture(t)}
                      disabled={busy}
                      className="rounded border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-50"
                    >
                      戻し
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Removed */}
      {tab === "removed" && (
        <section className="rounded-b-xl border border-t-0 border-neutral-800 p-4">
          {removedTasks.length === 0 ? (
            <div className="text-sm text-neutral-500">空</div>
          ) : (
            <ul className="space-y-2">
              {removedTasks.map((t) => (
                <li key={t.id} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">{t.title}</div>
                    <div className="text-xs text-neutral-400">（完了回数: {t.doneCount}）</div>
                    <div className="text-xs text-neutral-400">
                      {t.lastDoneDate ? `（${formatYYMMDD(t.dueDate)}→${formatYYMMDD(t.lastDoneDate)}）` : `（${formatYYMMDD(t.dueDate)}→）`}
                    </div>
                    <button
                      type="button"
                      onClick={() => onBackFromRemoved(t)}
                      disabled={busy}
                      className="rounded border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-50"
                    >
                      戻し
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {msg && (
        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
          {msg}
        </div>
      )}

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={async (u) => {
          setAuthOpen(false);
          setUser(u);
          await refresh(u);
          toast("ログイン");
        }}
      />
    </main>
  );
}

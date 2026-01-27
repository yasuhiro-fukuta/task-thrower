"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";

import AuthModal from "@/components/AuthModal";
import { auth } from "@/lib/firebaseClient";
import { addDaysISO, formatYYMMDD, todayISO } from "@/lib/dateOnly";
import {
  createTask,
  listTasks,
  completeTasks,
  rescheduleTasks,
  rescheduleTasksIndividually,
  removeTasks,
  updateOrdering,
  updateTask,
  type Task,
} from "@/lib/taskStore";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type TabKey = "TODAY" | "FUTURE" | "REMOVED";

type ThrowAction =
  | "TOMORROW"
  | "DAY_AFTER"
  | "WEEK"
  | "MONTH"
  | "MONTH3"
  | "YEAR"
  | "SWIPE"
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
    case "SWIPE":
    case "DONE":
    case "REMOVE":
      return null;
  }
}

function clampSortOrder(v: number): number {
  if (!Number.isFinite(v)) return 24;
  if (v < 1) return 1;
  if (v > 24) return 24;
  return Math.floor(v);
}

function buildSortOrderOptions() {
  const opts: number[] = [];
  for (let i = 1; i <= 24; i++) opts.push(i);
  return opts;
}

const SORT_ORDER_OPTIONS = buildSortOrderOptions();

function SortableTaskRow(props: {
  task: Task;
  busy: boolean;
  checked: boolean;
  onToggle: () => void;
  onChangeSortOrder: (v: number) => void;
  onTomorrow: () => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const { task, busy, checked, onToggle, onChangeSortOrder, onTomorrow, onDone, onRemove } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1,
    touchAction: "none",
  };

  const stopDragStart = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        "rounded-lg border px-3 py-2 text-sm select-none",
        "border-neutral-800 bg-neutral-950",
        isDragging ? "ring-2 ring-neutral-600" : "",
      ].join(" ")}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-2">
        {/* ソート順（表示＆編集） */}
        <select
          value={clampSortOrder(task.sortOrder)}
          disabled={busy}
          onChange={(e) => onChangeSortOrder(Number(e.target.value))}
          className="w-[64px] rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs"
          onPointerDownCapture={stopDragStart}
          onTouchStartCapture={stopDragStart}
          onMouseDownCapture={stopDragStart}
        >
          {SORT_ORDER_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

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

        {/* 完了回数（1回以上で表示） */}
        {task.doneCount >= 1 && (
          <div className="text-xs text-neutral-400" onPointerDownCapture={stopDragStart}>
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

export default function Page() {
  // Auth
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  // 左上日付（初期=シス日付 / 手動変更可）
  const [baseDate, setBaseDate] = useState<string>(() => todayISO());

  // Tabs
  const [tab, setTab] = useState<TabKey>("TODAY");

  // Tasks
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [sortOrderNew, setSortOrderNew] = useState<number>(24);
  const [busy, setBusy] = useState(false);

  // selection & throw
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [throwAction, setThrowAction] = useState<ThrowAction>("TOMORROW");

  // toast
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

  // 左上日付が変わったら選択はクリア（事故防止）
  useEffect(() => {
    setSelected({});
  }, [baseDate]);

  // 派生リスト
  const activeTasks = useMemo(() => allTasks.filter((t) => !t.removed), [allTasks]);

  // 今日のタスク：removed=false AND dueDate <= 左上日付
  const todayTasks = useMemo(() => {
    return activeTasks
      .filter((t) => t.dueDate <= baseDate)
      .sort((a, b) => {
        const ao = clampSortOrder(a.sortOrder);
        const bo = clampSortOrder(b.sortOrder);
        if (ao !== bo) return ao - bo;
        if ((a.sorter || 0) !== (b.sorter || 0)) return (a.sorter || 0) - (b.sorter || 0);
        return (a.createdAtMs || 0) - (b.createdAtMs || 0);
      });
  }, [activeTasks, baseDate]);

  // 未来のタスク：removed=false AND dueDate > 左上日付 / dueDate昇順
  const futureTasks = useMemo(() => {
    return activeTasks
      .filter((t) => t.dueDate > baseDate)
      .sort((a, b) => {
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return (a.createdAtMs || 0) - (b.createdAtMs || 0);
      });
  }, [activeTasks, baseDate]);

  // 廃棄済：removed=true / dueDate降順
  const removedTasks = useMemo(() => {
    return allTasks
      .filter((t) => t.removed)
      .sort((a, b) => {
        if (a.dueDate !== b.dueDate) return b.dueDate.localeCompare(a.dueDate);
        return (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
      });
  }, [allTasks]);

  // 選択は今日タスクに存在するものだけ残す
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

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected]
  );

  const toggle = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // 新規タスクの sorter 採番：同一sortOrder内の末尾へ
  const nextSorterForSortOrder = (so: number): number => {
    const target = clampSortOrder(so);
    const max = todayTasks
      .filter((t) => clampSortOrder(t.sortOrder) === target)
      .reduce((acc, t) => Math.max(acc, t.sorter || 0), 0);
    return (max || 0) + 1000;
  };

  // 2) タスク追加：dueDate = 左上日付
  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;

    if (!user) {
      setAuthOpen(true);
      return;
    }

    setBusy(true);
    try {
      const so = clampSortOrder(sortOrderNew);
      const sorter = nextSorterForSortOrder(so);
      await createTask({ uid: user.uid, title: t, dueDate: baseDate, sorter, sortOrder: so });
      setTitle("");
      await refresh(user);
      toast("追加");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "追加失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 事後：ソート順変更
  const onChangeSortOrder = async (id: string, newSO: number) => {
    if (!user) return setAuthOpen(true);
    const so = clampSortOrder(newSO);
    setBusy(true);
    try {
      const sorter = nextSorterForSortOrder(so);
      await updateTask(id, { sortOrder: so, sorter });
      await refresh(user);
      toast("順変更");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "順変更失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 今日行：明日へ（throwCount+1）
  const onTomorrow = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      const target = addDaysISO(baseDate, 1);
      await rescheduleTasks([id], target, { throwDelta: 1 });
      await refresh(user);
      toast("明日へ");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "更新失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 今日行：完了（done+1, lastDoneDate=baseDate）
  const onDone = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      await completeTasks([id], baseDate, { doneDelta: 1 });
      await refresh(user);
      toast("完了+1");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "完了失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 今日行：除去（removed=true）
  const onRemove = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      await removeTasks([id], true);
      await refresh(user);
      toast("除去");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "除去失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 7) 投げ先（まとめて）
  const onThrow = async () => {
    if (!user) return setAuthOpen(true);
    if (selectedIds.length === 0) return;

    setBusy(true);
    try {
      if (throwAction === "SWIPE") {
        // 仕様：チェックが付いたものを「画面の上から順」に i番目 -> (i+3)日後
        const checkedInOrder = todayTasks.filter((t) => selected[t.id]);
        const items = checkedInOrder.map((t, i) => ({
          id: t.id,
          dueDate: addDaysISO(baseDate, (i + 1) + 3), // i=0 -> 4日後
        }));
        await rescheduleTasksIndividually(items, { throwDelta: 1 });
        toast("スワイプ");
      } else if (throwAction === "DONE") {
        await completeTasks(selectedIds, baseDate, { doneDelta: 1, throwDelta: 1 });
        toast("完了+1");
      } else if (throwAction === "REMOVE") {
        await removeTasks(selectedIds, true, { throwDelta: 1 });
        toast("除去");
      } else {
        const days = actionToDays(throwAction)!;
        const target = addDaysISO(baseDate, days);
        await rescheduleTasks(selectedIds, target, { throwDelta: 1 });
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

  // 未来→戻し：dueDate=左上日付（throwCountは増やさない）
  const onBackFromFuture = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      await updateTask(id, { dueDate: baseDate, sorter: nextSorterForSortOrder(24) });
      await refresh(user);
      toast("戻し");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "戻し失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 廃棄済→戻し：dueDate=左上日付, removed解除
  const onBackFromRemoved = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      await updateTask(id, { dueDate: baseDate, removed: false, sorter: nextSorterForSortOrder(24) });
      await refresh(user);
      toast("復帰");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "復帰失敗"));
    } finally {
      setBusy(false);
    }
  };

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // スマホ：長押しでドラッグ開始（テキスト選択を抑える）
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // D&D 並べ替え：sorter更新 + 仕様「6と7の間に置いたら6になる」
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

    // ドロップ位置の前のタスクの sortOrder を継承（先頭なら次のタスク）
    const movedTask = moved[newIndex];
    const prev = newIndex > 0 ? moved[newIndex - 1] : null;
    const next = newIndex < moved.length - 1 ? moved[newIndex + 1] : null;
    const inheritedSO = prev ? clampSortOrder(prev.sortOrder) : next ? clampSortOrder(next.sortOrder) : clampSortOrder(movedTask.sortOrder);

    // sorterを全体順で振り直し。sortOrderは「移動したタスクのみ」変える
    const updates = moved.map((t, i) => ({
      id: t.id,
      sorter: (i + 1) * 1000,
      sortOrder: t.id === movedTask.id ? inheritedSO : clampSortOrder(t.sortOrder),
    }));

    setBusy(true);
    try {
      // ローカル反映
      const map = new Map(updates.map((u) => [u.id, { sorter: u.sorter, sortOrder: u.sortOrder }]));
      setAllTasks((prevAll) =>
        prevAll.map((t) => {
          const v = map.get(t.id);
          return v ? { ...t, sorter: v.sorter, sortOrder: v.sortOrder } : t;
        })
      );

      await updateOrdering(updates);
      toast("並べ替え");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "並べ替え失敗"));
      await refresh(user);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl p-6 text-neutral-100">
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
            value={sortOrderNew}
            onChange={(e) => setSortOrderNew(Number(e.target.value))}
            disabled={busy}
            className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-2 text-sm"
          >
            {SORT_ORDER_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タスクを追加（Enter）→ 自動で左上日付"
          className="flex-1 min-w-[260px] rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-700"
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
      <div className="mt-6 flex gap-2">
        {[
          ["TODAY", "今日のタスク"],
          ["FUTURE", "未来のタスク"],
          ["REMOVED", "廃棄済"],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k as TabKey)}
            className={[
              "rounded-t-lg border border-b-0 px-3 py-2 text-xs",
              tab === k ? "border-neutral-700 bg-neutral-950" : "border-neutral-800 bg-neutral-900/40",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Panels */}
      <section className="rounded-xl rounded-tl-none border border-neutral-800 bg-neutral-950 p-4">
        {tab === "TODAY" && (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">今日のタスク</div>
              <div className="text-xs text-neutral-400">選択中: {selectedIds.length}</div>
            </div>

            {todayTasks.length === 0 ? (
              <div className="mt-3 text-sm text-neutral-500">空</div>
            ) : (
              <div className="mt-3">
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
                          onChangeSortOrder={(v) => onChangeSortOrder(t.id, v)}
                          onTomorrow={() => onTomorrow(t.id)}
                          onDone={() => onDone(t.id)}
                          onRemove={() => onRemove(t.id)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </div>
            )}

            {/* 投げ先 */}
            <div className="mt-6 border-t border-neutral-800 pt-4">
              <div className="text-sm font-medium">投げ先</div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {[
                  ["TOMORROW", "明日"],
                  ["DAY_AFTER", "明後日"],
                  ["WEEK", "1週間"],
                  ["MONTH", "1ヶ月"],
                  ["MONTH3", "3か月"],
                  ["YEAR", "1年"],
                  ["SWIPE", "スワイプ"],
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
          </>
        )}

        {tab === "FUTURE" && (
          <>
            <div className="text-sm font-medium">未来のタスク</div>

            {futureTasks.length === 0 ? (
              <div className="mt-3 text-sm text-neutral-500">空</div>
            ) : (
              <ul className="mt-3 space-y-2">
                {futureTasks.map((t) => (
                  <li key={t.id} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">{t.title}</div>
                      <div className="text-xs text-neutral-400">({formatYYMMDD(t.dueDate)})</div>
                      <button
                        type="button"
                        onClick={() => onBackFromFuture(t.id)}
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
          </>
        )}

        {tab === "REMOVED" && (
          <>
            <div className="text-sm font-medium">廃棄済</div>

            {removedTasks.length === 0 ? (
              <div className="mt-3 text-sm text-neutral-500">空</div>
            ) : (
              <ul className="mt-3 space-y-2">
                {removedTasks.map((t) => (
                  <li key={t.id} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">{t.title}</div>
                      <div className="text-xs text-neutral-400">（完了回数: {t.doneCount}）</div>
                      <div className="text-xs text-neutral-400">
                        （{formatYYMMDD(t.dueDate)}→{t.lastDoneDate ? formatYYMMDD(t.lastDoneDate) : ""}）
                      </div>
                      <button
                        type="button"
                        onClick={() => onBackFromRemoved(t.id)}
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
          </>
        )}
      </section>

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

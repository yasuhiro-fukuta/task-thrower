"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";

import AuthModal from "@/components/AuthModal";
import { auth } from "@/lib/firebaseClient";
import { addDaysISO, formatYYMMDD, todayISO } from "@/lib/dateOnly";
import {
  createTask,
  listTasks,
  setRemoved,
  completeTasks,
  throwToDueDate,
  throwCompleteTasks,
  throwRemoveTasks,
  updateSorters,
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
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type ThrowAction =
  | "TOMORROW"
  | "DAY_AFTER"
  | "WEEK"
  | "MONTH"
  | "MONTH3"
  | "YEAR"
  | "DONE"
  | "REMOVE";

type MainTab = "TODAY" | "FUTURE" | "REMOVED";

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

function nextSorter(todayTasks: Task[]): number {
  const max = todayTasks.reduce((acc, t) => Math.max(acc, t.sorter || 0), 0);
  return (max || 0) + 1000;
}

/**
 * dnd-kit: タスク行（行全体を掴める）
 * ただし、チェックボックス・ボタンはクリックできるように "drag開始を止める" 対策を入れる
 */
function SortableTaskRow(props: {
  task: Task;
  busy: boolean;
  checked: boolean;
  onToggle: () => void;
  onTomorrow: () => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const { task, busy, checked, onToggle, onTomorrow, onDone, onRemove } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1,
    // モバイルでドラッグを効かせる
    touchAction: "none",
    // モバイル長押しでのテキスト選択/コールアウトを抑止
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  };

  const stopDragStart = (e: React.SyntheticEvent) => {
    // 行全体に drag listener が乗るので、操作系UIはドラッグ開始を止める
    e.stopPropagation();
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
      // 行全体を掴める（PCもスマホも）
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-2">
        {/* 並び替え用の見た目（ハンドルじゃなく飾り。掴むのは行全体） */}
        <span className="select-none text-neutral-600">⋮⋮</span>

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

        {/* 完了回数（1回以上のときだけ表示） */}
        {task.doneCount >= 1 && (
          <span className="text-xs text-neutral-400">完了×{task.doneCount}</span>
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

  // Tasks
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  // selection & throw
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [throwAction, setThrowAction] = useState<ThrowAction>("TOMORROW");

  // タブ表示
  const [tab, setTab] = useState<MainTab>("TODAY");

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

  // タブを切り替えたら選択はクリア（事故防止）
  useEffect(() => {
    if (tab !== "TODAY") setSelected({});
  }, [tab]);

  // 派生リスト
  const activeTasks = useMemo(() => allTasks.filter((t) => !t.removed), [allTasks]);

  // 3) 今日のタスク：removed=false AND (dueDate <= 左上日付)
  const todayTasks = useMemo(() => {
    return activeTasks
      .filter((t) => t.dueDate <= baseDate)
      .sort((a, b) => {
        if (a.sorter !== b.sorter) return (a.sorter || 0) - (b.sorter || 0);
        return (a.createdAtMs || 0) - (b.createdAtMs || 0);
      });
  }, [activeTasks, baseDate]);

  // 9) 未来のタスク：removed=false AND (dueDate > 左上日付) / dueDate昇順
  const futureTasks = useMemo(() => {
    return activeTasks
      .filter((t) => t.dueDate > baseDate)
      .sort((a, b) => {
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return (a.createdAtMs || 0) - (b.createdAtMs || 0);
      });
  }, [activeTasks, baseDate]);

  // 12) 廃棄済：removed=true / dueDate降順
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
      const sorter = nextSorter(todayTasks);
      await createTask({ uid: user.uid, title: t, dueDate: baseDate, sorter });
      setTitle("");
      await refresh(user);
      toast("追加");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "追加失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 個別：明日へ（dueDate = 左上日付 + 1） + 投げ回数+1
  const onTomorrow = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      const target = addDaysISO(baseDate, 1);
      await throwToDueDate([id], target);
      await refresh(user);
      toast("明日へ");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "更新失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 5) 完了（個別）：doneCount += 1
  const onDone = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      await completeTasks([id], baseDate);
      await refresh(user);
      toast("完了+1");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "完了失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 6) 除去（個別）
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

  // 7) 投げ先（まとめて）
  const onThrow = async () => {
    if (!user) return setAuthOpen(true);
    if (selectedIds.length === 0) return;

    setBusy(true);
    try {
      if (throwAction === "DONE") {
        await throwCompleteTasks(selectedIds, baseDate);
        toast("完了+1");
      } else if (throwAction === "REMOVE") {
        await throwRemoveTasks(selectedIds);
        toast("除去");
      } else {
        const days = actionToDays(throwAction)!;
        const target = addDaysISO(baseDate, days);
        await throwToDueDate(selectedIds, target);
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

  // 10) 未来→戻し：dueDate = 左上日付
  const onBackFromFuture = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      const sorter = nextSorter(todayTasks);
      await updateTask(id, { dueDate: baseDate, sorter });
      await refresh(user);
      toast("戻し");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "戻し失敗"));
    } finally {
      setBusy(false);
    }
  };

  // 13) 廃棄済→戻し：dueDate=左上日付, removed=false
  const onBackFromRemoved = async (id: string) => {
    if (!user) return setAuthOpen(true);
    setBusy(true);
    try {
      const sorter = nextSorter(todayTasks);
      await updateTask(id, { dueDate: baseDate, removed: false, sorter });
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
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 }, // PC：押して少し動かしたらドラッグ開始
    }),
useSensor(TouchSensor, {
  activationConstraint: { delay: 180, tolerance: 8 },
}),
    useSensor(KeyboardSensor)
  );

  // 8) 並べ替え：dropでsorter更新（今日タスクのみ）
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

    // sorterを 1000,2000,... に振り直し
    const updates = moved.map((t, i) => ({ id: t.id, sorter: (i + 1) * 1000 }));

    setBusy(true);
    try {
      // 先にローカル反映（体感速い）
      const map = new Map(updates.map((u) => [u.id, u.sorter]));
      setAllTasks((prev) =>
        prev.map((t) => {
          const s = map.get(t.id);
          return s ? { ...t, sorter: s } : t;
        })
      );

      await updateSorters(updates);
      toast("並べ替え");
    } catch (err: any) {
      toast(String(err?.message ?? err ?? "並べ替え失敗"));
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
              <div className="text-xs text-neutral-300">
                {user.displayName || user.email}
              </div>
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

      <form onSubmit={onAdd} className="mt-4 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タスクを追加（Enter）→ 自動で左上日付"
          className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-700"
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

      {/* タブ（今日 / 未来 / 廃棄済） */}
      <div className="mt-6">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setTab("TODAY")}
            className={[
              "rounded-t-lg border border-neutral-800 px-3 py-2 text-sm",
              tab === "TODAY"
                ? "bg-neutral-950 text-neutral-100"
                : "bg-neutral-900/40 text-neutral-400 hover:bg-neutral-950 hover:text-neutral-100",
            ].join(" ")}
            disabled={busy}
          >
            今日のタスク
          </button>

          <button
            type="button"
            onClick={() => setTab("FUTURE")}
            className={[
              "rounded-t-lg border border-neutral-800 px-3 py-2 text-sm",
              tab === "FUTURE"
                ? "bg-neutral-950 text-neutral-100"
                : "bg-neutral-900/40 text-neutral-400 hover:bg-neutral-950 hover:text-neutral-100",
            ].join(" ")}
            disabled={busy}
          >
            未来のタスク
          </button>

          <button
            type="button"
            onClick={() => setTab("REMOVED")}
            className={[
              "rounded-t-lg border border-neutral-800 px-3 py-2 text-sm",
              tab === "REMOVED"
                ? "bg-neutral-950 text-neutral-100"
                : "bg-neutral-900/40 text-neutral-400 hover:bg-neutral-950 hover:text-neutral-100",
            ].join(" ")}
            disabled={busy}
          >
            廃棄済
          </button>

          <div className="ml-auto text-xs text-neutral-400">
            {tab === "TODAY" ? `選択中: ${selectedIds.length}` : ""}
          </div>
        </div>

        <section className="rounded-b-xl rounded-tr-xl border border-neutral-800 p-4">
          {/* TODAY */}
          {tab === "TODAY" && (
            <>
              {todayTasks.length === 0 ? (
                <div className="text-sm text-neutral-500">空</div>
              ) : (
                <div>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onDragEnd}
                  >
                    <SortableContext
                      items={todayTasks.map((t) => t.id)}
                      strategy={verticalListSortingStrategy}
                    >
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
                          />
                        ))}
                      </ul>
                    </SortableContext>
                  </DndContext>
                </div>
              )}

              {/* 投げ先 */}
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

                <div className="mt-2 text-xs text-neutral-500">
                  ※チェック→投げ先→投げる
                </div>
              </div>
            </>
          )}

          {/* FUTURE */}
          {tab === "FUTURE" && (
            <>
              {futureTasks.length === 0 ? (
                <div className="text-sm text-neutral-500">空</div>
              ) : (
                <ul className="space-y-2">
                  {futureTasks.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1">{t.title}</div>
                        <div className="text-xs text-neutral-400">
                          ({formatYYMMDD(t.dueDate)})
                        </div>
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

          {/* REMOVED */}
          {tab === "REMOVED" && (
            <>
              {removedTasks.length === 0 ? (
                <div className="text-sm text-neutral-500">空</div>
              ) : (
                <ul className="space-y-2">
                  {removedTasks.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1">{t.title}</div>

                        <div className="text-xs text-neutral-400">（完了回数: {t.doneCount}）</div>
                        <div className="text-xs text-neutral-400">
                          （{formatYYMMDD(t.dueDate)}→
                          {t.lastDoneDate ? formatYYMMDD(t.lastDoneDate) : ""}）
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
      </div>

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

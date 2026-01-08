"use client";

import { GoogleAuthProvider, signInWithPopup, type User } from "firebase/auth";
import { useState } from "react";
import { auth } from "@/lib/firebaseClient";

export default function AuthModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      onSuccess(res.user);
    } catch (e: any) {
      setError(e?.message ?? "ログインに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={busy ? undefined : onClose} />

      <div className="absolute left-1/2 top-1/2 w-[360px] max-w-[90vw]
                      -translate-x-1/2 -translate-y-1/2
                      rounded-xl bg-neutral-900 border border-neutral-700 p-4">
        <h2 className="text-sm font-semibold mb-3">ログイン</h2>

        <button
          onClick={signIn}
          disabled={busy}
          className="w-full rounded-lg bg-white text-black py-2 text-sm disabled:opacity-50"
        >
          Googleでログイン
        </button>

        {error && (
          <div className="mt-2 text-xs text-red-400 whitespace-pre-wrap">{error}</div>
        )}

        <button
          onClick={onClose}
          disabled={busy}
          className="mt-3 w-full text-xs text-neutral-400"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

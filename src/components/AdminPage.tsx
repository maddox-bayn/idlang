import { useEffect, useState } from "react";
import AuthModal from "./AuthModal";
import type { User, Book } from "../types";
import { fetchCurrentUser, logoutUser, fetchAdminOverview, fetchAdminUsers, fetchAdminLibrary, reviewLibraryItem, libraryFileURL, type AdminOverview, type AdminAccount } from "../api/socialClient";

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminAccount[]>([]);
  const [drafts, setDrafts] = useState<Book[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [draftPage, setDraftPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [draftTotal, setDraftTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => { fetchCurrentUser().then(setUser).finally(() => setChecking(false)); }, []);
  useEffect(() => {
    if (user?.role !== "admin") return;
    let cancelled = false;
    setBusy(true); setError(null);
    Promise.all([fetchAdminOverview(), fetchAdminUsers(userPage), fetchAdminLibrary(draftPage)])
      .then(([summary, accounts, library]) => {
        if (cancelled) return;
        setOverview(summary); setUsers(accounts.users); setUserTotal(accounts.total);
        setDrafts(library.items); setDraftTotal(library.total);
      }).catch(error => {
        if (!cancelled) {
          setOverview(null); setUsers([]); setDrafts([]);
          setError(error instanceof Error ? error.message : "Could not load administration data.");
        }
      }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [user, userPage, draftPage, revision]);

  async function signOut() {
    try { await logoutUser(); setUser(null); setOverview(null); setUsers([]); setDrafts([]); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not sign out."); }
  }
  async function review(id: string, status: "published" | "rejected") {
    setBusy(true); setError(null);
    try { await reviewLibraryItem(id, status); setRevision(value => value + 1); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not review this submission."); setBusy(false); }
  }
  const button = "rounded-lg border border-red-800 px-4 py-2 text-sm text-red-100 hover:bg-red-950 disabled:opacity-40";
  return <div className="min-h-screen bg-black text-red-100">
    <header className="border-b border-red-900/40 px-6 py-5"><div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
      <div><p className="text-xs uppercase tracking-widest text-red-500">Idlang</p><h1 className="font-heading text-2xl font-bold">Administration</h1></div>
      <div className="flex gap-3"><a className={button} href="/">Back to translation</a>{user && <button className={button} onClick={signOut}>Sign out</button>}</div>
    </div></header>
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      {error && <p role="alert" className="rounded-lg border border-red-800 bg-red-950/40 p-4">{error} <button onClick={() => setRevision(value => value + 1)} className="underline">Retry</button></p>}
      {checking ? <p>Checking access…</p> : !user ? <section className="rounded-xl border border-red-900/50 p-8 space-y-4">
        <h2 className="font-heading text-2xl">Administrator sign-in</h2><p className="text-neutral-400">Sign in with your administrator account to manage Idlang.</p>
        <button className={button} onClick={() => setShowLogin(true)}>Sign in</button>
      </section> : user.role !== "admin" ? <section role="alert" className="space-y-3"><h2 className="font-heading text-2xl">Administrator access required</h2><p className="text-neutral-400">This account does not have access to administration.</p></section> : <>
        <section className="grid gap-4 sm:grid-cols-3" aria-label="Overview">
          {[["Accounts", overview?.users], ["Posts", overview?.posts], ["Awaiting review", overview?.drafts]].map(([label, value]) => <div key={label} className="rounded-xl border border-red-900/50 bg-neutral-950 p-5"><p className="text-sm text-neutral-400">{label}</p><p className="mt-2 text-3xl font-bold">{value ?? "—"}</p></div>)}
        </section>
        {overview && <p className="text-sm text-neutral-500">Database: {overview.database === "turso" ? "Turso libSQL" : "Local SQLite"}</p>}
        {busy && <p role="status" className="text-red-300">Loading…</p>}
        <section className="space-y-4"><h2 className="font-heading text-xl">Registered accounts</h2>
          <div className="overflow-x-auto rounded-xl border border-red-900/40"><table className="w-full text-left text-sm"><thead className="bg-neutral-950 text-neutral-400"><tr>{["Name", "Username", "Role", "Status"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{users.map(account => <tr key={account.id} className="border-t border-red-950"><td className="p-3">{account.display_name}</td><td className="p-3">@{account.username}</td><td className="p-3">{account.role}</td><td className="p-3">{account.status}</td></tr>)}</tbody></table></div>
          <div className="flex items-center gap-3"><button className={button} disabled={busy || userPage === 1} onClick={() => setUserPage(value => value - 1)}>Previous</button><span className="text-sm">Page {userPage}</span><button className={button} disabled={busy || userPage * 25 >= userTotal} onClick={() => setUserPage(value => value + 1)}>Next</button></div>
        </section>
        <section className="space-y-4"><h2 className="font-heading text-xl">Library submissions</h2>
          {!busy && !drafts.length && <p className="text-neutral-400">No submissions awaiting review on this page.</p>}
          {drafts.map(book => <article key={book.id} className="rounded-xl border border-red-900/40 bg-neutral-950 p-5 space-y-3"><h3 className="font-heading text-lg">{book.title}</h3><p className="text-sm text-neutral-400">{book.author} · {book.license}</p><p className="text-sm">{book.description}</p><div className="flex flex-wrap gap-3"><a className={button} href={libraryFileURL(book)} target="_blank" rel="noreferrer">Review document</a><button className={button} disabled={busy} onClick={() => review(book.id, "published")}>Publish</button><button className={button} disabled={busy} onClick={() => review(book.id, "rejected")}>Reject</button></div></article>)}
          <div className="flex items-center gap-3"><button className={button} disabled={busy || draftPage === 1} onClick={() => setDraftPage(value => value - 1)}>Previous</button><span className="text-sm">Page {draftPage}</span><button className={button} disabled={busy || draftPage * 24 >= draftTotal} onClick={() => setDraftPage(value => value + 1)}>Next</button></div>
        </section>
      </>}
    </main>
    {showLogin && <AuthModal isOpen initialMode="login" onClose={() => setShowLogin(false)} onSuccess={setUser} />}
  </div>;
}

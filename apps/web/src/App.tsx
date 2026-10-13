import { useEffect, useState, type FormEvent } from 'react';
import Dashboard from './Dashboard';

type User = { id: string; email: string; displayName: string };
type AuthMode = 'login' | 'register';
const features = [
  { icon: '✦', title: 'Anılarınız', text: 'Birlikte yaşadığınız güzel anları fotoğraflar ve notlarla saklayın.' },
  { icon: '♡', title: 'Size özel mektuplar', text: 'Aklınızdan geçenleri yazın; doğru zamanda birbirinize açın.' },
  { icon: '☼', title: 'Ortak hayaller', text: 'Yapılacaklar listenizi birlikte kurun ve tamamladıkça işaretleyin.' },
];

async function authRequest(path: string, body?: unknown) {
  const response = await fetch(`/api/v1/auth/${path}`, {
    method: body ? 'POST' : 'GET', credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message ?? 'Sunucuya ulaşılamadı.');
  return result.data as { user?: User; ok?: boolean };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    authRequest('me').then(({ user: currentUser }) => setUser(currentUser ?? null)).catch(() => setUser(null)).finally(() => setCheckingSession(false));
  }, []);

  const openAuth = (mode: AuthMode) => { setError(''); setAuthMode(mode); };
  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const result = await authRequest(authMode === 'register' ? 'register' : 'login',
        authMode === 'register' ? { displayName, email, password } : { email, password });
      setUser(result.user ?? null); setAuthMode(null); setDisplayName(''); setEmail(''); setPassword('');
    } catch (cause) {
      setError(cause instanceof TypeError ? 'Sunucuya ulaşılamıyor. API sunucusunun ve PostgreSQL veritabanının çalıştığını kontrol et.' : cause instanceof Error ? cause.message : 'Bir sorun oluştu. Tekrar dene.');
    } finally { setLoading(false); }
  };
  const logout = async () => {
    try { await authRequest('logout', {}); } catch { /* Local UI still returns to signed-out state. */ }
    setUser(null);
  };

  if (user) return <Dashboard user={user} onLogout={logout} />;

  return <main className="min-h-screen overflow-hidden px-5 text-rose-950">
    <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_#ffe4e9_0%,_#fff8f7_48%,_#fffdfb_100%)]" />
    <header className="mx-auto flex max-w-6xl items-center justify-between py-6">
      <a className="flex items-center gap-2 text-lg font-bold tracking-tight" href="#home"><span className="text-rose-500">♥</span> LoveSpace</a>
      <button onClick={() => openAuth('login')} disabled={checkingSession} className="rounded-full border border-rose-200 bg-white/70 px-5 py-2 text-sm font-semibold hover:bg-white disabled:opacity-60">{checkingSession ? 'Yükleniyor…' : 'Giriş yap'}</button>
    </header>
    <section id="home" className="mx-auto grid max-w-6xl items-center gap-12 py-14 md:grid-cols-[1.05fr_.95fr] md:py-24">
      <div>
        <span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[.16em] text-rose-600">İkiniz için küçük bir dünya</span>
        <h1 className="mt-7 max-w-xl text-5xl font-semibold leading-[1.05] tracking-[-.05em] md:text-7xl">Birlikte biriktirdiğiniz <span className="text-rose-500">her şey.</span></h1>
        <p className="mt-6 max-w-lg text-lg leading-8 text-rose-900/65">Anılarınız, mektuplarınız ve sıradaki hayaliniz… İkinize ait, sıcacık bir yerde.</p>
        <div className="mt-8 flex flex-wrap gap-3"><button onClick={() => openAuth('register')} className="rounded-full bg-rose-500 px-6 py-3 font-semibold text-white shadow-lg shadow-rose-300/40 transition hover:-translate-y-0.5 hover:bg-rose-600">Birlikte başlayın <span aria-hidden="true">→</span></button><a className="rounded-full border border-rose-200 bg-white/70 px-6 py-3 font-semibold hover:bg-white" href="#features">Keşfet</a></div>
        <p className="mt-4 text-xs text-rose-900/45">Hesap açıp giriş yapabilirsin. Ortak alan ve diğer özellikler sıradaki geliştirme aşamasında.</p>
      </div>
      <div className="relative mx-auto w-full max-w-md" aria-label="LoveSpace anı kartı önizlemesi">
        <div className="absolute -right-5 top-8 h-20 w-20 animate-pulse rounded-full bg-rose-200/70 blur-2xl motion-reduce:animate-none" />
        <article className="relative rotate-2 rounded-[2rem] border border-white bg-white/80 p-4 shadow-2xl shadow-rose-200/50 backdrop-blur transition hover:rotate-0">
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[1.4rem] bg-gradient-to-br from-rose-200 via-pink-100 to-orange-100"><div className="text-center"><span className="text-6xl">🌷</span><p className="mt-2 text-sm font-medium text-rose-800/60">Birlikte güzel bir gün</p></div></div>
          <div className="flex items-start justify-between px-2 pb-2 pt-5"><div><p className="font-semibold">Küçük anlar, büyük mutluluklar</p><p className="mt-1 text-sm text-rose-900/50">Anılarınız burada çoğalır</p></div><span className="rounded-full bg-rose-50 px-3 py-1 text-rose-500">♥</span></div>
        </article>
        <div className="absolute -bottom-7 -left-7 rounded-2xl border border-white bg-white/90 px-4 py-3 shadow-xl shadow-rose-200/30"><span className="text-xs text-rose-900/50">Birlikte geçen</span><p className="font-semibold text-rose-600">her gün özel ✨</p></div>
      </div>
    </section>
    <section id="features" className="mx-auto max-w-6xl pb-24 pt-10"><div className="mb-7"><p className="text-sm font-semibold uppercase tracking-[.16em] text-rose-500">İkinize ait</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">Güzel şeylere yer açın.</h2></div><div className="grid gap-4 md:grid-cols-3">{features.map((item) => <article key={item.title} className="rounded-3xl border border-rose-100 bg-white/65 p-6 transition hover:-translate-y-1 hover:bg-white"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-rose-50 text-xl text-rose-500">{item.icon}</span><h3 className="mt-5 font-semibold">{item.title}</h3><p className="mt-2 text-sm leading-6 text-rose-900/60">{item.text}</p></article>)}</div></section>
    <footer className="mx-auto max-w-6xl border-t border-rose-100 py-6 text-center text-xs text-rose-900/40">LoveSpace · Güzel anılar birlikte birikir.</footer>

    {authMode && <div className="fixed inset-0 z-20 grid place-items-center bg-rose-950/35 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthMode(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="auth-title" className="w-full max-w-md rounded-[2rem] border border-white bg-[#fffafa] p-7 shadow-2xl sm:p-9">
        <div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-rose-500">LoveSpace'e hoş geldin</p><h2 id="auth-title" className="mt-2 text-3xl font-semibold tracking-tight">{authMode === 'login' ? 'Tekrar merhaba' : 'Hesabını oluştur'}</h2></div><button aria-label="Pencereyi kapat" onClick={() => setAuthMode(null)} className="rounded-full px-3 py-1 text-xl text-rose-800/50 hover:bg-rose-50">×</button></div>
        <p className="mt-2 text-sm leading-6 text-rose-900/60">{authMode === 'login' ? 'Anılarınıza kaldığınız yerden devam edin.' : 'İkinize ait küçük dünyayı oluşturmaya başlayın.'}</p>
        <form onSubmit={submitAuth} className="mt-6 space-y-4">
          {authMode === 'register' && <label className="block text-sm font-medium">Adın<input required maxLength={80} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-rose-200 bg-white px-4 py-3 outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100" placeholder="Adın" /></label>}
          <label className="block text-sm font-medium">E-posta<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-rose-200 bg-white px-4 py-3 outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100" placeholder="ornek@email.com" /></label>
          <label className="block text-sm font-medium">Parola<input required type="password" minLength={12} maxLength={128} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-rose-200 bg-white px-4 py-3 outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100" placeholder="En az 12 karakter" /></label>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button disabled={loading} className="w-full rounded-xl bg-rose-500 py-3.5 font-semibold text-white shadow-lg shadow-rose-200 transition hover:bg-rose-600 disabled:opacity-60">{loading ? 'Bekle…' : authMode === 'login' ? 'Giriş yap' : 'Hesap oluştur'}</button>
        </form>
        <p className="mt-5 text-center text-sm text-rose-900/60">{authMode === 'login' ? 'Henüz hesabın yok mu?' : 'Zaten hesabın var mı?'} <button onClick={() => openAuth(authMode === 'login' ? 'register' : 'login')} className="font-semibold text-rose-600 hover:underline">{authMode === 'login' ? 'Hesap oluştur' : 'Giriş yap'}</button></p>
        <p className="mt-4 text-center text-xs text-rose-900/40">Hesap oluşturmak için PostgreSQL veritabanının çalışıyor olması gerekir.</p>
      </section>
    </div>}
  </main>;
}

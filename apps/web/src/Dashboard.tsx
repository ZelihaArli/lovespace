import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import ChaseGame from './ChaseGame';

type User = { id: string; email: string; displayName: string };
type Couple = { id: string; relationshipStartDate: string | null; createdAt: string; memberCount: number };
type Memory = { id: string; createdBy: string; title: string; body: string; happenedAt: string | null; visibility: 'shared' | 'private'; createdAt: string };
type Letter = { id: string; authorId: string; title: string; body: string; status: 'draft' | 'sent'; sentAt: string | null; createdAt: string };
type BucketItem = { id: string; title: string; notes: string; status: 'open' | 'done'; createdAt: string };
type ChatMessage = { id: string; clientId: string; senderId: string; body: string; createdAt: string };
type Game = { id: string; status: string; version: number; state: { board: (string | null)[]; players: string[]; turn: string; winner: string | null } };
type ApiOptions = { method?: string; body?: unknown };
type Tab = 'home' | 'memories' | 'letters' | 'list' | 'chat' | 'games';

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET', credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message ?? 'İstek tamamlanamadı.');
  return result.data as T;
}

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Genel bakış', icon: '⌂' },
  { id: 'memories', label: 'Anılar', icon: '✦' },
  { id: 'letters', label: 'Mektuplar', icon: '✉' },
  { id: 'list', label: 'Ortak liste', icon: '☑' },
  { id: 'chat', label: 'Sohbet', icon: '♡' },
  { id: 'games', label: 'Mini oyun', icon: '✿' },
];
const dateLabel = (value: string) => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long' }).format(new Date(value));

export default function Dashboard({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  const [couple, setCouple] = useState<Couple | null>(null);
  const [partner, setPartner] = useState<{ id: string; displayName: string } | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [startDate, setStartDate] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [items, setItems] = useState<BucketItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [live, setLive] = useState(false);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; sender: string }[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [newMemory, setNewMemory] = useState({ title: '', body: '', visibility: 'shared' as 'shared' | 'private' });
  const [newLetter, setNewLetter] = useState({ title: '', body: '' });
  const [newItem, setNewItem] = useState({ title: '', notes: '' });
  const [messageText, setMessageText] = useState('');

  const loadCouple = useCallback(async () => {
    try {
      const data = await api<{ couple: Couple; partner: { id: string; displayName: string } | null }>('/couples/me');
      setCouple(data.couple); setPartner(data.partner); setStartDate(data.couple.relationshipStartDate?.slice(0, 10) ?? '');
      return data;
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('çift alanı')) { setCouple(null); setPartner(null); return null; }
      throw cause;
    }
  }, []);

  const loadTabData = useCallback(async (selected: Tab) => {
    try {
      if (selected === 'memories') setMemories((await api<{ items: Memory[] }>('/memories')).items);
      if (selected === 'letters') setLetters((await api<{ items: Letter[] }>('/letters')).items);
      if (selected === 'list') setItems((await api<{ items: BucketItem[] }>('/bucket-items')).items);
      if (selected === 'chat') setMessages((await api<{ items: ChatMessage[] }>('/chat/messages')).items);
      if (selected === 'games') setGames((await api<{ games: Game[] }>('/games')).games);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'İçerikler yüklenemedi.'); }
  }, []);

  useEffect(() => { loadCouple().catch((cause) => setError(cause instanceof Error ? cause.message : 'Çift alanı yüklenemedi.')); }, [loadCouple]);
  useEffect(() => { if (couple) void loadTabData(tab); }, [couple, tab, loadTabData]);

  useEffect(() => {
    if (!couple || !partner) { socket?.disconnect(); setSocket(null); setLive(false); return; }
    const liveSocket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    setSocket(liveSocket);
    liveSocket.on('connect', () => setLive(true));
    liveSocket.on('disconnect', () => setLive(false));
    liveSocket.on('connect_error', (cause: Error) => { setLive(false); setError(`Canlı bağlantı kurulamadı: ${cause.message}`); });
    liveSocket.on('chat:message', (message: ChatMessage) => setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]));
    liveSocket.on('reaction:new', (reaction: { id: string; emoji: string; userId: string }) => {
      setReactions((current) => [...current, { id: reaction.id, emoji: reaction.emoji, sender: reaction.userId === user.id ? 'Sen' : partner.displayName }].slice(-5));
      window.setTimeout(() => setReactions((current) => current.filter((item) => item.id !== reaction.id)), 5000);
    });
    liveSocket.on('game:state', (game: Game) => setGames((current) => [game, ...current.filter((item) => item.id !== game.id)]));
    return () => { liveSocket.disconnect(); setSocket(null); };
  }, [couple?.id, partner?.id, user.id]);

  const daysTogether = useMemo(() => {
    if (!couple?.relationshipStartDate) return null;
    const [year, month, day] = couple.relationshipStartDate.slice(0, 10).split('-').map(Number);
    const start = Date.UTC(year, month - 1, day); const today = new Date();
    return Math.max(0, Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - start) / 86_400_000));
  }, [couple?.relationshipStartDate]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Bir sorun oluştu. Tekrar dene.'); }
    finally { setBusy(false); }
  };

  const createCouple = () => run(async () => {
    await api('/couples', { method: 'POST', body: {} }); await loadCouple();
  });
  const acceptInvitation = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    await api('/couples/invitations/accept', { method: 'POST', body: { token: inviteInput.trim() } });
    setInviteInput(''); await loadCouple();
  }); };
  const createInvitation = () => run(async () => {
    const data = await api<{ token: string }>('/couples/invitations', { method: 'POST', body: {} }); setInviteToken(data.token);
  });
  const saveDate = () => run(async () => {
    const result = await api<{ couple: Couple }>('/couples/me', { method: 'PATCH', body: { relationshipStartDate: startDate || null } });
    setCouple((value) => value ? { ...value, ...result.couple } : value);
  });
  const saveMemory = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const result = await api<{ item: Memory }>('/memories', { method: 'POST', body: newMemory }); setMemories((value) => [result.item, ...value]); setNewMemory({ title: '', body: '', visibility: 'shared' });
  }); };
  const saveLetter = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const result = await api<{ item: Letter }>('/letters', { method: 'POST', body: { ...newLetter, status: 'sent' } }); setLetters((value) => [result.item, ...value]); setNewLetter({ title: '', body: '' });
  }); };
  const saveItem = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const result = await api<{ item: BucketItem }>('/bucket-items', { method: 'POST', body: newItem }); setItems((value) => [result.item, ...value]); setNewItem({ title: '', notes: '' });
  }); };
  const updateItem = (item: BucketItem) => run(async () => {
    const result = await api<{ item: BucketItem }>(`/bucket-items/${item.id}`, { method: 'PATCH', body: { status: item.status === 'done' ? 'open' : 'done' } });
    setItems((value) => value.map((entry) => entry.id === item.id ? result.item : entry));
  });
  const sendMessage = (event: FormEvent) => {
    event.preventDefault(); if (!socket || !messageText.trim()) return;
    const body = messageText.trim(); setMessageText('');
    socket.emit('chat:send', { clientId: crypto.randomUUID(), body }, (result: { ok: boolean; error?: { message: string } }) => {
      if (!result.ok) setError(result.error?.message ?? 'Mesaj gönderilemedi.');
    });
  };
  const sendHeart = () => socket?.emit('reaction:send', { clientId: crypto.randomUUID(), emoji: '❤️' });
  const startGame = () => run(async () => {
    const result = await api<{ game: Game }>('/games', { method: 'POST', body: {} }); setGames((value) => [result.game, ...value]);
  });
  const playCell = (game: Game, cell: number) => socket?.emit('game:move', { gameId: game.id, cell }, (result: { ok: boolean; error?: { message: string } }) => {
    if (!result.ok) setError(result.error?.message ?? 'Bu hamle yapılamadı.');
  });

  const panel = (children: ReactNode, className = '') => <section className={`rounded-3xl border border-rose-100 bg-white/80 p-5 shadow-sm sm:p-7 ${className}`}>{children}</section>;
  const title = (eyebrow: string, heading: string, help?: string) => <div className="mb-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-rose-500">{eyebrow}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h2>{help && <p className="mt-2 text-sm text-rose-900/55">{help}</p>}</div>;

  return <div className="min-h-screen bg-[#fff8f8] text-rose-950">
    <header className="sticky top-0 z-10 border-b border-rose-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a className="shrink-0 text-lg font-bold tracking-tight" href="#home"><span className="text-rose-500">♥</span> LoveSpace</a>
        <div className="min-w-0 text-center"><p className="truncate text-sm font-semibold">{partner ? `Sen & ${partner.displayName}` : 'Senin küçük alanın'}</p><p className="text-xs text-rose-900/50">{live ? '● Birlikte çevrimiçi' : couple ? 'Birlikte biriktirin' : 'Partnerini davet et'}</p></div>
        <button onClick={() => void onLogout()} className="shrink-0 rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold hover:bg-rose-50">Çıkış yap</button>
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      {error && <div role="alert" className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{error}</span><button onClick={() => setError('')} aria-label="Uyarıyı kapat">×</button></div>}
      {!couple ? <div className="mx-auto max-w-3xl space-y-5 pt-8">
        {panel(<>{title('Birlikte başlayın', 'Önce ikinize ait bir alan oluşturalım.', 'Bir kişi alanı oluşturup davet kodunu partneriyle paylaşır. Partnerin kendi LoveSpace hesabında bu kodu girerek katılır.')}
          <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-rose-50/80 p-5"><p className="font-semibold">Alanı sen oluştur</p><p className="mb-4 mt-1 text-sm text-rose-900/55">Sonra çıkan davet kodunu partnerine gönder.</p><button disabled={busy} onClick={createCouple} className="rounded-xl bg-rose-500 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-60">Çift alanı oluştur</button></div>
            <form onSubmit={acceptInvitation} className="rounded-2xl bg-orange-50/70 p-5"><label className="block font-semibold">Davet kodun var mı?<input value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} className="mt-3 w-full rounded-xl border border-rose-200 bg-white px-4 py-3 font-normal outline-none focus:ring-4 focus:ring-rose-100" placeholder="Partnerinin gönderdiği kod" /></label><button disabled={busy || inviteInput.length < 20} className="mt-3 rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold hover:bg-rose-50 disabled:opacity-50">Davetle katıl</button></form>
          </div>
        </>)}
      </div> : <>
        {!partner && <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:flex sm:items-center sm:justify-between"><div><p className="font-semibold">Partnerin henüz katılmadı</p><p className="mt-1 text-sm text-rose-900/60">Davet kodunu oluşturup ona gönder. Davet 7 gün geçerlidir.</p></div><button disabled={busy} onClick={createInvitation} className="mt-3 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white sm:mt-0">Davet kodu oluştur</button></div>}
        {inviteToken && <div className="mb-5 rounded-2xl border border-rose-200 bg-white p-4"><p className="text-sm font-semibold">Partnerinle paylaşacağın davet kodu</p><code className="mt-2 block break-all rounded-xl bg-rose-50 p-3 text-sm">{inviteToken}</code><button onClick={() => void navigator.clipboard?.writeText(inviteToken)} className="mt-2 text-sm font-semibold text-rose-600">Kodu kopyala</button></div>}
        <section className="mb-5 grid gap-4 md:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-3xl bg-gradient-to-br from-rose-500 to-pink-400 p-6 text-white shadow-lg shadow-rose-200 sm:p-8"><p className="text-sm font-semibold text-white/75">İlişki sayacınız</p><p className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{daysTogether === null ? '♡' : `${daysTogether} gün`}</p><p className="mt-2 text-sm text-white/80">{daysTogether === null ? 'Başlangıç tarihini ekleyince sayaç burada görünür.' : startDate ? `${dateLabel(startDate)} tarihinden beri birlikte.` : 'Birlikte biriktirdiğiniz her gün.'}</p></div>
          <div className="rounded-3xl border border-rose-100 bg-white p-5"><label className="block text-sm font-semibold">İlişki başlangıç tarihi<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 w-full rounded-xl border border-rose-200 px-3 py-2.5 outline-none focus:ring-4 focus:ring-rose-100" /></label><button disabled={busy} onClick={saveDate} className="mt-3 rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100">Tarihi kaydet</button></div>
        </section>
        <nav className="mb-5 flex gap-2 overflow-x-auto rounded-2xl border border-rose-100 bg-white p-2">{tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${tab === item.id ? 'bg-rose-500 text-white' : 'text-rose-900/65 hover:bg-rose-50'}`}><span>{item.icon}</span>{item.label}</button>)}</nav>

        {tab === 'home' && <div className="grid gap-4 md:grid-cols-2">{tabs.slice(1).map((item) => <button key={item.id} onClick={() => setTab(item.id)} className="rounded-3xl border border-rose-100 bg-white p-6 text-left transition hover:-translate-y-0.5 hover:shadow-md"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-rose-50 text-xl text-rose-500">{item.icon}</span><h3 className="mt-4 font-semibold">{item.label}</h3><p className="mt-1 text-sm text-rose-900/55">{item.id === 'memories' ? 'Güzel günleri kaydedin.' : item.id === 'letters' ? 'Birbirinize mektup bırakın.' : item.id === 'list' ? 'Birlikte yapmak istediklerinizi ekleyin.' : item.id === 'chat' ? 'Canlı olarak konuşup kalp gönderin.' : 'Sırayla X-O oynayın.'}</p></button>)}</div>}

        {tab === 'memories' && <div className="space-y-5">{panel(<>{title('Zaman kapsülü', 'Anılarınız', 'Gününüzü, küçük bir notla buraya bırakın.')}
          <form onSubmit={saveMemory} className="grid gap-3 sm:grid-cols-2"><input required maxLength={160} value={newMemory.title} onChange={(event) => setNewMemory({ ...newMemory, title: event.target.value })} className="rounded-xl border border-rose-200 px-4 py-3 outline-none focus:ring-4 focus:ring-rose-100" placeholder="Anıya bir başlık ver" /><select value={newMemory.visibility} onChange={(event) => setNewMemory({ ...newMemory, visibility: event.target.value as 'shared' | 'private' })} className="rounded-xl border border-rose-200 bg-white px-4 py-3"><option value="shared">İkimiz de görebiliriz</option><option value="private">Sadece ben görebilirim</option></select><textarea value={newMemory.body} onChange={(event) => setNewMemory({ ...newMemory, body: event.target.value })} className="min-h-24 rounded-xl border border-rose-200 px-4 py-3 sm:col-span-2" placeholder="Bu günü özel yapan neydi?" /><button disabled={busy} className="rounded-xl bg-rose-500 px-5 py-3 font-semibold text-white sm:col-span-2 sm:justify-self-start">Anıyı kaydet</button></form>
        </>)}<div className="grid gap-4 md:grid-cols-2">{memories.map((memory) => <article key={memory.id} className="rounded-3xl border border-rose-100 bg-white p-5"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{memory.title}</h3><span className="rounded-full bg-rose-50 px-3 py-1 text-xs text-rose-600">{memory.visibility === 'private' ? 'Kişisel' : 'Ortak'}</span></div>{memory.body && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-rose-900/70">{memory.body}</p>}<p className="mt-4 text-xs text-rose-900/40">{dateLabel(memory.happenedAt ?? memory.createdAt)}</p></article>)}</div>{memories.length === 0 && <p className="py-5 text-center text-sm text-rose-900/50">Henüz anı yok. İlkini sen ekle.</p>}</div>}

        {tab === 'letters' && <div className="grid gap-5 lg:grid-cols-[.85fr_1.15fr]">{panel(<>{title('Kalpten', 'Mektup bırak', 'Gönderdiğinde partnerin de görebilir.')}
          <form onSubmit={saveLetter} className="space-y-3"><input maxLength={160} value={newLetter.title} onChange={(event) => setNewLetter({ ...newLetter, title: event.target.value })} className="w-full rounded-xl border border-rose-200 px-4 py-3" placeholder="Mektup başlığı" /><textarea required maxLength={20000} value={newLetter.body} onChange={(event) => setNewLetter({ ...newLetter, body: event.target.value })} className="min-h-48 w-full rounded-xl border border-rose-200 px-4 py-3" placeholder="Aklından geçenleri yaz…" /><button disabled={busy} className="rounded-xl bg-rose-500 px-5 py-3 font-semibold text-white">Mektubu gönder</button></form>
        </>)}<div className="space-y-4">{letters.map((letter) => <article key={letter.id} className="rounded-3xl border border-rose-100 bg-white p-5 sm:p-7"><p className="text-xs font-semibold uppercase tracking-wider text-rose-500">{letter.authorId === user.id ? (letter.status === 'draft' ? 'Taslağın' : 'Sen gönderdin') : 'Sana bir mektup'}</p><h3 className="mt-2 text-xl font-semibold">{letter.title || 'Sevgiden bir not'}</h3><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-rose-900/75">{letter.body}</p><p className="mt-4 text-xs text-rose-900/40">{dateLabel(letter.sentAt ?? letter.createdAt)}</p></article>)}{letters.length === 0 && panel(<p className="py-8 text-center text-sm text-rose-900/50">Henüz mektup yok. İlk notu sen bırak.</p>)}</div></div>}

        {tab === 'list' && <div className="grid gap-5 lg:grid-cols-[.85fr_1.15fr]">{panel(<>{title('Sıradaki hayaliniz', 'Ortak liste', 'Birlikte yapmak istediğiniz güzel şeyleri yazın.')}
          <form onSubmit={saveItem} className="space-y-3"><input required maxLength={240} value={newItem.title} onChange={(event) => setNewItem({ ...newItem, title: event.target.value })} className="w-full rounded-xl border border-rose-200 px-4 py-3" placeholder="Örn. gün batımında sahile git" /><textarea value={newItem.notes} onChange={(event) => setNewItem({ ...newItem, notes: event.target.value })} className="min-h-20 w-full rounded-xl border border-rose-200 px-4 py-3" placeholder="Not ekle (isteğe bağlı)" /><button disabled={busy} className="rounded-xl bg-rose-500 px-5 py-3 font-semibold text-white">Listeye ekle</button></form>
        </>)}<div className="space-y-3">{items.map((item) => <article key={item.id} className={`flex items-start gap-3 rounded-2xl border bg-white p-4 ${item.status === 'done' ? 'border-emerald-100' : 'border-rose-100'}`}><button onClick={() => void updateItem(item)} aria-label={item.status === 'done' ? 'Tamamlanmadı olarak işaretle' : 'Tamamlandı olarak işaretle'} className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border ${item.status === 'done' ? 'border-emerald-400 bg-emerald-400 text-white' : 'border-rose-300 text-transparent'}`}>✓</button><div className="min-w-0 flex-1"><p className={`font-medium ${item.status === 'done' ? 'text-rose-900/45 line-through' : ''}`}>{item.title}</p>{item.notes && <p className="mt-1 text-sm text-rose-900/55">{item.notes}</p>}</div><span className="text-xs text-rose-900/40">{item.status === 'done' ? 'Tamamlandı' : 'Sırada'}</span></article>)}{items.length === 0 && panel(<p className="py-8 text-center text-sm text-rose-900/50">Listeniz şimdilik boş. İlk planınızı ekleyin.</p>)}</div></div>}

        {tab === 'chat' && <div className="grid gap-5 lg:grid-cols-[1fr_auto]">{panel(<>{title('Canlı sohbet', 'Birbirinize yazın', 'Mesajlar anında iletilir ve sonradan da burada kalır.')}
          {!partner ? <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-900/70">Canlı sohbet için önce partnerinin davet koduyla katılması gerekiyor.</p> : <><div className="mb-4 flex h-[360px] flex-col gap-3 overflow-y-auto rounded-2xl bg-rose-50/70 p-4">{messages.map((message) => <div key={message.id} className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.senderId === user.id ? 'self-end bg-rose-500 text-white' : 'self-start bg-white text-rose-950'}`}><p className="whitespace-pre-wrap break-words text-sm">{message.body}</p><p className={`mt-1 text-right text-[10px] ${message.senderId === user.id ? 'text-white/70' : 'text-rose-900/40'}`}>{new Date(message.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</p></div>)}{messages.length === 0 && <p className="m-auto text-sm text-rose-900/50">İlk mesajı sen gönder 💌</p>}</div><form onSubmit={sendMessage} className="flex gap-2"><input value={messageText} onChange={(event) => setMessageText(event.target.value)} maxLength={4000} className="min-w-0 flex-1 rounded-xl border border-rose-200 px-4 py-3" placeholder="Bir şeyler yaz…" /><button disabled={!live || !messageText.trim()} className="rounded-xl bg-rose-500 px-5 font-semibold text-white disabled:opacity-50">Gönder</button></form><div className="mt-3 flex items-center gap-3"><button disabled={!live} onClick={sendHeart} className="rounded-full bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 disabled:opacity-50">❤️ Kalp gönder</button><span className="text-xs text-rose-900/45">{live ? 'Canlı bağlantı açık' : 'Bağlanıyor…'}</span></div></>}
        </>)}<div className="flex flex-col gap-2">{reactions.map((reaction) => <div key={reaction.id} className="animate-bounce rounded-2xl border border-rose-100 bg-white px-4 py-3 text-sm shadow-sm motion-reduce:animate-none">{reaction.emoji} {reaction.sender} gönderdi</div>)}</div></div>}

        {tab === 'games' && <div className="space-y-5"><ChaseGame socket={socket} userId={user.id} partnerId={partner?.id ?? null} partnerName={partner?.displayName ?? 'Partnerin'} />{partner && <details className="rounded-3xl border border-rose-100 bg-white p-5"><summary className="cursor-pointer font-semibold text-rose-800">X-O oyunu (ekstra)</summary><button disabled={busy} onClick={startGame} className="mt-4 rounded-xl bg-rose-100 px-4 py-2.5 text-sm font-semibold text-rose-700">Yeni X-O oyunu başlat</button><div className="mt-4 grid gap-3 sm:grid-cols-2">{games.map((game) => <article key={game.id} className="rounded-2xl border border-rose-100 p-4"><p className="mb-3 text-sm font-medium">{game.status === 'active' ? game.state.turn === user.id ? 'Sıra sende' : `${partner.displayName} düşünüyor…` : game.state.winner ? 'Oyun bitti' : 'Berabere bitti'}</p><div className="mx-auto grid max-w-[220px] grid-cols-3 gap-2">{game.state.board.map((mark, cell) => <button key={cell} disabled={game.status !== 'active' || game.state.turn !== user.id || mark !== null || !live} onClick={() => playCell(game, cell)} className="grid aspect-square place-items-center rounded-xl bg-rose-50 text-3xl font-semibold text-rose-500 disabled:cursor-default">{mark}</button>)}</div></article>)}</div></details>}</div>}
      </>}
    </main>
  </div>;
}

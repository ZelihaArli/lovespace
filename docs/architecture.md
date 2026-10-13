# Mimari ve sözleşmeler

## Sınırlar

Web istemcisi REST ile kalıcı kaynakları yönetir; Socket.IO yalnızca düşük gecikmeli sohbet/tepki ve oyun olayları içindir. API, PostgreSQL'e erişimin tek sahibidir. İlişki verisi `couple_id` ile bölümlenir. İstemciden gelen `coupleId` hiçbir zaman yetki kanıtı değildir: her REST sorgusunda ve socket olayında oturumdaki kullanıcının üyeliği doğrulanır.

Önerilen modüller: `auth`, `users`, `couples`, `memories`, `letters`, `bucket-list`, `chat`, `reactions`, `games`, `uploads`, `notifications`. Modüller Express router + servis + veri erişim katmanı şeklinde ayrılır. Şema değişiklikleri sürümlü migration'larla yönetilir; `schema.sql` ilk kurulum referansıdır.

## REST API (JSON, `/api/v1`)

Başarılı kaynak yanıtı `{ "data": ... }`; hata `{ "error": { "code", "message", "details?" } }`. Her yanıtta `X-Request-Id` başlığı bulunur. Geçerli uygulama bazı listelerde en çok 100 kayıt döndürür; cursor sayfalama sonraki aşamada eklenmelidir. Tarihler ISO 8601.

| Method | Route | Erişim / amaç |
|---|---|---|
| POST | `/auth/register` | Uygulandı; e-posta, 12+ karakter parola, görünen ad; scrypt parola hash'i ve 30 günlük HttpOnly oturum cookie'si |
| POST | `/auth/login` | Uygulandı; aynı güvenli oturum cookie'si; 15 dakikada 10 istek sınırı |
| GET | `/auth/me` | Uygulandı; geçerli oturum kullanıcısını döndürür |
| POST | `/auth/logout` | Uygulandı; oturumu iptal eder ve cookie'yi temizler |
| POST | `/auth/verify-email` | Planlandı; henüz uygulanmadı |
| POST | `/auth/password/forgot`, `/auth/password/reset` | Planlandı; henüz uygulanmadı |
| GET/PATCH | `/users/me` | Oturum sahibi profilini okur/günceller |
| POST | `/couples/invitations` | Uygulandı; 7 günlük tek kullanımlık davet kodu üretir |
| POST | `/couples` | Uygulandı; çift alanı açar |
| POST | `/couples/invitations/accept` | Uygulandı; daveti kabul eder ve çift sınırını denetler |
| GET | `/couples/me` | Uygulandı; ilişki tarihi, üyelik ve partner adı |
| PATCH | `/couples/me` | Uygulandı; ilişki başlangıç tarihi |
| GET/POST | `/memories` | Uygulandı; paylaşılan ve kişisel metin anıları |
| DELETE | `/memories/:id` | Uygulandı; oluşturan kişi anıyı kaldırabilir |
| GET/POST | `/letters` | Uygulandı; taslak yalnızca yazara görünür, gönderilen mektup paylaşılır |
| DELETE | `/letters/:id` | Uygulandı; yazarı mektubu kaldırabilir |
| GET/POST | `/bucket-items` | Uygulandı; ortak listeyi getirir ve madde ekler |
| PATCH/DELETE | `/bucket-items/:id` | Uygulandı; tamamlandı durumunu değiştirir veya kaldırır |
| GET | `/chat/messages` | Uygulandı; son 100 mesajı getirir |
| POST | `/chat/messages` | Uygulandı; mesajı veritabanına kaydeder, partner çevrimdışı olsa da gönderilebilir |
| GET/POST | `/chase-games/current`, `/chase-games` | Uygulandı; iki kişilik kovalamaca oyununu kalıcı olarak başlatır ve durumunu getirir |
| PATCH | `/chase-games/:id/move` | Uygulandı; hamleyi veritabanı kilidiyle kaydeder, iki ekran düzenli yenileyerek eşitlenir |
| GET/POST | `/games` | Uygulandı; son oyunları listeler ve X-O oyunu başlatır |
| GET | `/games/:id` | Uygulandı; oyun durumunu döndürür |
| PATCH | `/games/:id/move` | Uygulandı; X-O hamlesini sırayı doğrulayarak kaydeder |
| POST | `/uploads/presign` | Planlandı; henüz uygulanmadı |
| GET | `/health/live`, `/health/ready` | Canlılık ve DB dahil hazır olma kontrolü; hassas ayrıntı döndürmez |

Uygulanan gövdeler Zod ile doğrulanır. Sohbet ve tepki olayları istemci kimliğiyle yinelenen gönderime karşı güvenlidir. Genel idempotency anahtarı ve kapsamlı audit kayıtları sonraki aşamada eklenmelidir.

## Socket.IO

Handshake HttpOnly oturum cookie'si ile yapılır. Bağlanınca kullanıcı oturumu ve çift üyeliği sunucudan bulunur; sunucu `couple:<id>` odasına ekler. İstemci oda seçemez. Veritabanı kalıcı durumun kaynağıdır; sohbet ve oyun ekranları Vercel işlev örnekleri arasında Socket.IO odaları paylaşılmadığı için REST üzerinden düzenli yenilenir. Socket.IO yalnızca aynı örneğe bağlı kullanıcılar arasında hızlı yayın sağlar.

| Yön | Olay | Şema / davranış |
|---|---|---|
| client→server | `chat:send` | `{clientId, body}`; doğrula, DB'ye yaz, sonra yayınla; ack döner |
| server→room | `chat:message` | `{id, clientId, senderId, body, createdAt}`; aynı kullanıcıya ack de döner |
| client→server | `reaction:send` | `{clientId, emoji}`; emoji allowlist'i |
| server→room | `reaction:new` | `{id, clientId, userId, emoji, createdAt}` |
| client→server | `game:move` | `{gameId, cell}`; sıra ve hamle geçerliliği sunucuda kontrol edilir |
| server→room | `game:state` | Yetkili güncel durum/sürüm; yarışan hamlelerde optimistic version kontrolü |
| iki yön | `event:error` | `{code, message, clientId?}`; gizli veri içermez |

Tüm client olayları ack callback ile `{ok, data?}` veya `{ok:false,error}` yanıtlar. Mesajlar kalıcılaştırıldıktan sonra yayınlanır. Çoklu API kopyasında Redis adapter gerekir; üretim tasarımına ekleyin. Yeniden bağlanma sonrası geçmiş REST üzerinden senkronlanır.

## Güvenlik / gizlilik

- Parola: Node.js `scrypt` (N=32768, r=8, p=1), sabit uzunlukta salt ve zamanlamaya dayanıklı karşılaştırma; üretim öncesi parametreleri gözden geçir. Login/register için IP bazlı hız sınırı.
- Oturum belirteci rastgele üretilir ve veritabanında yalnız hash'i saklanır; cookie `HttpOnly`, üretimde `Secure`, `SameSite=Lax`. E-posta doğrulama ve yenileme/rotasyon akışı sonraki adımda eklenmelidir.
- E-posta doğrulanmadan davet oluşturma ve hassas işlemleri kapat. Parola sıfırlama/e-posta yanıtlarında hesap keşfini önle.
- PostgreSQL parametreli sorgular, migration kullanıcı yetkilerinin en az ayrıcalığı, transaction ve FK'ler.
- İçerik çıktısını escape et; HTML kabul etme. Yüklemeleri private object storage'da tut, MIME/magic bytes ve boyut kontrol et, görüntüleri yeniden kodla, kısa ömürlü imzalı indirme ver.
- Loglarda parola, token, mektup gövdesi ve sohbet metni yok. IP/email gibi kişisel verileri asgari tut; silme/dışa aktarma ve saklama politikası tanımla.
- Üretim: TLS, güvenli başlıklar, dar CORS, CSP, yedekleme ve geri yükleme provası, secret manager, izleme ve olay müdahale planı.

## Dağıtım topolojisi

Web statik CDN; API konteyneri; yönetilen PostgreSQL; SMTP/e-posta sağlayıcısı; private object storage; Redis (yatay ölçekli Socket.IO) ve hata/metric izleme. Migration'lar dağıtım öncesinde tek sefer çalışır. Sağlık kontrolleri, rolling deploy ve yedekten geri dönüş planı gerekir. İlk yayında tek API instance kullanılabilir; yatay ölçek açılınca Redis adapter ve sticky bağlantı gereksinimini doğrulayın.

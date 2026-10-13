# LoveSpace

Çiftler için anılar, mektuplar, ortak liste, canlı sohbet ve oyun sunan web uygulaması.

## Teknoloji

- `apps/web`: React, TypeScript, Vite, Tailwind CSS
- `apps/api`: Node.js, TypeScript, Express, Socket.IO
- PostgreSQL; SQL şeması `docs/schema.sql` içinde
- npm workspaces monorepo

## Hızlı başlangıç

1. Node.js 20+ ve Docker Desktop kurun; Docker Desktop uygulamasını başlatın.
2. Proje klasöründe `docker compose up -d db` çalıştırın. Bu yerel geliştirme veritabanını ve tabloları oluşturur.
3. `.env` ayarı hazırdır. Farklı veritabanı kullanacaksanız `.env.example` dosyasını kopyalayıp `DATABASE_URL` değerini değiştirin.
4. PowerShell'de `npm.cmd install`, ardından `npm.cmd run dev` çalıştırın.

API `http://localhost:4000`, web `http://localhost:5173` adresinde açılır. Giriş/kayıt ve içerik için Docker Desktop ile veritabanı çalışır durumda olmalı. Kayıt olup giriş yaptıktan sonra çift alanı oluşturabilir, davet kodunu partnerinle paylaşabilir; anı, mektup, ilişki tarihi ve ortak liste kullanabilir, partnerin katılınca canlı sohbet/kalp tepkileri ve X-O oynayabilirsin.

Yerel veritabanı parolası yalnız geliştirme içindir; üretimde kullanmayın. Görsel yükleme, e-posta doğrulama, parola sıfırlama ve X-O dışındaki oyunlar henüz ekli değil. Yayınlanmış veya güvenlik denetiminden geçmiş bir ürün değildir; `docs/implementation-plan.md` içindeki kapılar tamamlanmadan genel kullanıma açmayın.

## Klasör yapısı

```text
lovespace/
├── apps/
│   ├── api/src/{config,db,http,middleware,realtime,modules}/
│   └── web/src/{app,components,features,lib,pages}/
├── docs/{architecture.md,implementation-plan.md,schema.sql}
├── .env.example
├── package.json
└── README.md
```

## Ortam değişkenleri

`.env.example` tüm zorunlu ayarları ve güvenli üretim notlarını içerir. Üretimde sırları secret manager üzerinden verin; `.env` dosyasını depoya koymayın.

## Ürün dilimi

1. E-posta/parola hesabı, doğrulama ve oturum yönetimi.
2. Tek kullanımlık çift daveti; davet kabulüyle iki kişilik ilişki alanı.
3. Anılar, mektuplar ve ilişki başlangıç tarihi.
4. Ortak yapılacaklar/gezilecekler listesi.
5. Yetkili Socket.IO odasında sohbet ve kalp tepkileri.
6. İki oyunculu mini oyunlar; sunucu doğrulamalı hamleler.

Detaylı API, olay sözleşmeleri, veri modeli ve uygulama sırası `docs/` altındadır.

# Uygulama yol haritası

## 0. Ürün ve operasyon temeli

- Alan adı, marka, yaş sınırı, gizlilik metni, kullanım koşulları ve veri saklama/silme sürecini netleştir.
- Dev/staging/prod ortamlarını ve secret manager'ı hazırla; PostgreSQL yedekleme ve geri yükleme provası kur.
- Monorepo CI: lint, typecheck, birim/entegrasyon/e2e testleri, dependency ve secret taraması.

## 1. İskelet ve hesap

- API ve web workspace'lerini oluştur; env şema doğrulaması, logger, request ID, hata sözleşmesi, sağlık kontrolleri.
- PostgreSQL migration altyapısı, seed yalnız yerel geliştirme için.
- Kayıt, e-posta doğrulama, giriş, refresh rotasyonu, çıkış, parola sıfırlama; erişilebilir form ve e-posta akışları.
- Testler: parola hash'i, token rotasyonu/replay, doğrulanmamış hesap, rate limit, CSRF ve hata mesajlarında hesap keşfi.

## 2. Çift alanı ve içerik

- Davet oluştur/kabul/iptal, sona erme, token hash'i, tek çift üyeliği ve yarış koşullarını transaction/lock ile çöz.
- Çift özeti ve başlangıç tarihi; sayaç istemcide tarihten hesaplanır ve timezone politikasını açıkça tanımlar.
- Anı, özel/paylaşılan mektup, taslak/gönderim, ortak liste için CRUD ve cursor pagination.
- Her uç için partner dışı erişim, IDOR, yanlış `couple_id`, silinmiş kaynak ve alan doğrulama testleri.

## 3. Medya ve deneyim

- Romantik pembe görsel sistem, responsive layout, reduced-motion desteği, klavye erişimi ve boş/yükleniyor/hata durumları.
- Görsel yükleme için private bucket, presigned URL, MIME/boyut sınırı ve güvenli sunum.
- İlişki sayacı, anı akışı, mektup yazma/okuma ve ortak liste ekranlarını API ile bağla.

## 4. Gerçek zamanlı özellikler

- Socket handshake JWT, DB üyeliği ile oda tayini, olay şemaları ve rate limit.
- Sohbeti DB'ye yazıp sonra yayınla; geçmiş sayfalama, client idempotency, reconnect senkronizasyonu.
- Kalp tepkilerini allowlist ve hedef kaynak yetkisiyle kaydet/yayınla.
- Oyun durum makinesi sunucuda; sıra kontrolü ve version conflict; temel oyun tic-tac-toe, ardından quiz/tercih oyunu.
- Test: yetkisiz odaya katılma, reconnect, çift gönderim, iki instance/Redis adapter ve eşzamanlı hamle.

## 5. Yayına hazırlık

- E2E kullanıcı yolculuğu: kayıt → doğrulama → davet → kabul → ortak içerik → sohbet/oyun → hesap/veri silme.
- Güvenlik incelemesi: OWASP ASVS temeli, bağımlılık taraması, secret scan, kötüye kullanım/rate limit ve yükleme taraması.
- Log/metric/trace, alarm eşikleri, hata izleme, DB pool ve Socket.IO bağlantı gözlemi.
- Staging'de yük, yedekten geri dönüş, migration rollback/forward-only stratejisi, e-posta teslim testi.
- Gizlilik ve destek kanalları tamamlandıktan, kritik bulgular kapandıktan sonra kademeli public launch.

## Kabul ölçütleri

- Partner olmayan kullanıcı herhangi bir çift içeriğini REST, socket veya medya URL'si üzerinden okuyamaz/yazamaz.
- Refresh token yalnız bir kez kullanılabilir; logout/revoke sonrası socket bağlantısı da geçersiz hale gelir.
- Tüm kalıcı listeler sayfalı; tüm kullanıcı girdileri doğrulanmış; hatalar request ID taşır.
- Üretimde TLS, güvenli cookie, yedekleme, alarm, secret yönetimi ve hesap/veri silme yolu çalışır.

# GitHub Vault Sync (Obsidian eklentisi)

Türkçe · [English](README.md)

Obsidian vault'unu bir GitHub deposuyla **çift yönlü** senkronlar. Git kurmanız gerekmez: eklenti GitHub'ın web API'sini kullanır, bu yüzden Windows, Mac, Linux ve iPhone/iPad'de aynı şekilde çalışır.

## Ne yapar

- Vault'taki dosyaları GitHub deposundaki bir dalla eşitler. Metin, resim ve diğer dosyalar dahil.
- Bir dosya yalnızca sizde değiştiyse GitHub'a yükler, yalnızca GitHub'da değiştiyse (ör. bir bot ya da başka bir cihaz yazdıysa) indirir.
- Yüklemeleri tek bir commit olarak yapar.
- Senkron zamanı: Obsidian açılırken, belirlediğiniz aralıkta (varsayılan 5 dk) ve bir dosyayı değiştirdikten 1 dakika sonra. İsterseniz elle de çalıştırabilirsiniz (sol şeritteki yenile simgesi ya da "GitHub ile şimdi senkronla" komutu).

## Kurulum

### Yol 1: BRAT ile (önerilen, otomatik güncellenir)

1. Obsidian → Ayarlar → **Community plugins** → "Restricted mode"u kapatın → **Browse** → **BRAT** eklentisini kurup etkinleştirin.
2. BRAT ayarlarında **Add beta plugin** → `Alpinoo/github-obsidian-sync` yazın → ekleyin.
3. Community plugins listesinden **GitHub Vault Sync**'i etkinleştirin.
4. Aşağıdaki "Ayarlar" bölümüne göre token ve depo bilgilerini girin.

Yeni sürüm yayınlandığında BRAT eklentiyi kendiliğinden günceller.

### Yol 2: Elle

1. [Releases](https://github.com/Alpinoo/github-obsidian-sync/releases) sayfasından `main.js` ve `manifest.json` dosyalarını indirin.
2. Vault klasörünüzde `.obsidian/plugins/github-vault-sync/` klasörünü oluşturup dosyaları içine koyun. (`.obsidian` gizli bir klasördür.)
3. Obsidian'ı yeniden başlatın, Community plugins'den eklentiyi etkinleştirin.

## Ayarlar

| Ayar | Açıklama |
|---|---|
| **GitHub token** | GitHub'da fine-grained token üretin: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). *Repository access:* yalnızca senkronlanacak depo. *Permissions → Contents:* **Read and write**. |
| **Kullanıcı / Depo / Dal** | Örneğin `kullanici`, `notlarim`, `main`. Depo önceden var olmalı ve en az bir commit içermeli. |
| **Otomatik senkron aralığı** | Dakika cinsinden. `0` kapalı. |
| **Açılışta senkronla** | Obsidian açılınca bir kez çalışır. |
| **Değişiklikten 1 dk sonra senkronla** | Dosya değişince kısa bir bekleyişten sonra senkronlar. |

Token **her cihazda ayrıca** girilir. Token yalnızca o cihazdaki eklenti ayarlarında durur ve hiçbir yere gönderilmez (GitHub API çağrıları dışında).

## Çakışmalar ve silme

Eklenti her dosya için son başarılı senkrondaki halini hatırlar ve üç tarafı karşılaştırır (yerel, GitHub, son senkron).

| Durum | Ne olur |
|---|---|
| Yalnızca yerel değişti | GitHub'a yüklenir |
| Yalnızca GitHub'da değişti | Yerele indirilir |
| **İkisi de değişti** | Sizin yerel sürümünüz yüklenir; GitHub'daki sürüm yanına `ad (çakışma TARİH).md` olarak indirilir. Elle birleştirip fazlasını silin. Veri kaybolmaz. |
| Yerelde silindi | GitHub'dan da silinir |
| GitHub'da silindi | Yerelde Obsidian çöpüne taşınır |
| Bir tarafta silindi, diğerinde değişti | Silinmez, değişen sürüm korunur |

Güvenlik önlemleri:

- Tek senkronda 25'ten fazla silme gerekirse eklenti **durur** ve hata verir (olası ayar hatasına karşı).
- Uzak depo boş görünüyorsa yerel dosyalar silinmez.
- Noktayla başlayan klasör ve dosyalar (`.obsidian`, `.git`, `.trash` vb.) hiç senkronlanmaz. Token `.obsidian` içinde durduğu için bu önemlidir.
- 25 MB üstü dosyalar atlanır.

## Sınırlar

- Her senkronda GitHub'daki tüm dosya listesi okunur. Çok büyük depolarda (on binlerce dosya) GitHub listeyi keser ve eklenti hata verip durur.
- Birden fazla cihaz aynı anda yazarsa eklenti en fazla 3 kez yeniden dener; olmazsa bir sonraki senkronda tekrar dener.
- Çakışma çözümü dosya düzeyindedir, satır satır birleştirme yapmaz.
- Gizli klasörler (`.obsidian` dahil) senkronlanmadığı için eklentiler, temalar ve ayarlar cihazlar arasında taşınmaz.
- GitHub dosya adlarında Windows'un kabul etmediği karakterler (`: * ? " < > |`) varsa o dosya Windows'ta oluşturulamaz.

## Geliştirme

```bash
npm install --legacy-peer-deps
npm run build
```

Derleme `main.js` dosyasını üretir. Sürüm yayınlamak için `manifest.json` ve `package.json` içindeki `version` değerini artırın, ardından `main.js` ve `manifest.json` dosyalarını aynı sürüm numarasıyla bir GitHub release'ine ekleyin (BRAT ve elle kurulum release dosyalarını kullanır).

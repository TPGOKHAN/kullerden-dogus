# ⚔️ Küllerden Doğuş

Köyü yakılmış bir liderin küllerden yeniden doğuşu: kaynak topla, köyünü kur, ordunu
eğit, düşman kalelerini kuşat ve fantezi cihanının 14 vilayetini fethet.

**▶ Oyna: https://tpgokhan.github.io/kullerden-dogus/**

Kurulum yok, indirme yok — linke tıkla, oyna. İlerlemen tarayıcında saklanır.

---

## Öne çıkanlar

- **Menüsüz inşaat** — arsanın yanında dur, kaynakların uçarak gider, bina yükselir
- **Oto yönetim** — köyün ve karakolların kendi kendini kurar, tamir eder, asker basar
- **12 ırk** — samuraylar, gladyatörler, mızraklılar, atlılar, buz halkı… her biri farklı
  renk, silah ve dövüş tarzıyla
- **Katmanlı kaleler** — yüksek kademe vilayetlerde iç içe üç sur, her kapısı ayrı kırılır
- **Rütbe sistemi** — askerler leşle XP toplar, terfilerini sen onaylarsın (maks Sv.10);
  komutanlar Sv.20'ye kadar çıkar, görev alır, kendi ordularını kurar
- **Kuşatma** — mancınık/koçbaşı kur, gizlice sız, surdaki nöbetçileri okla indir
- **Hava durumu**, gece baskınları, kıtlık, yaban hayatı, at binme, mağara koşuları
- **Arkadaş sistemi** — davet koduyla arkadaş ekle, köyünü ziyaret et, ortak
  **Dostluk Adası**'nda birlikte savaş

## Birlikte oynamak

1. 🤝 **Yoldaşlar** → *Çevrimiçi Ol* → adını yaz, 6 haneli davet kodun çıkar
2. Kodu arkadaşınla paylaş, o *Arkadaş Ekle* deyip girsin
3. Artık birbirinizin köyünü ziyaret edip yardım edebilir (topladığın her şey ona kalır)
   ya da *Ada Kur / Adaya Katıl* ile ortak üsse geçebilirsiniz

## Kontroller

| Tuş | İşlev |
|---|---|
| `WASD` / oklar | yürü |
| `Boşluk` | saldır (basılı tut = güçlü vuruş) |
| `Shift` / `X` | atıl (hasarsız kaçınma) |
| `E` | etkileşim |
| `M` | harita |
| `H` | ata bin / in |

## Teknik

Bağımlılıksız vanilla JavaScript + Canvas 2D. Tüm grafikler ve sesler prosedürel
(tek bir görsel/ses dosyası yok). Çok oyunculu taraf Supabase üzerinde çalışır;
veritabanına erişim yalnızca RLS kilitli tablolar üzerindeki RPC'lerle mümkündür.

```
index.html   · sayfa iskeleti ve HUD
game.js      · oyunun tamamı (dünya, AI, çizim, kayıt, ağ)
style.css    · HUD, paneller, ana menü
```

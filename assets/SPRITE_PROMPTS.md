# Küllerden Doğuş — Nano Banana Pro sprite üretim rehberi

Bu dosya, oyunun görsel kalitesini referans oyunlar seviyesine taşımak için tüm
karakter / düşman / bina / çevre görsellerinin **Nano Banana Pro (Gemini 3 Pro
Image)** promptlarını içerir. Görselleri üretip ilgili klasöre koyunca bana
"hazır" de, ben `game.js`'e tek tek bağlayacağım.

---

## 0. ÖNCE OKU — motorun görsel mantığı (bu, promptların NEDEN böyle olduğunu anlatır)

Oyun **gerçek izometrik değil**, "billboard" (dik levha) çizim sistemi kullanıyor:

- Her nesne DİK çizilir, tabanı (ayaklar / bina temeli) yere değen noktadadır;
  motor arkadan öne Y sırasına göre çizer (painter's algorithm). Referans 2'deki
  (mavi çatılı köy) **hakiki izometrik** görünümün birebir aynısı için motoru
  baştan yazmak gerekir (çarpışma, co-op determinizmi, derinlik sıralaması hepsi
  değişir) — bu ayrı ve büyük bir iş. **Bu rehber, mevcut motora oturan yol:**
  aynı billboard sistemi + prosedürel şekiller yerine elle boyanmış PNG sprite'lar.
  Bu, riske girmeden görsel sıçramanın ~%80'ini verir; referansların "boyalı
  masal" dokusunu yakalar.
- **Karakterler sağa/sola AYNALANIR, dönmez.** Yani her karakteri **sağa bakar**
  şekilde tek görsel üretmen yeterli; motor sola giderken yatay çevirir.
- **Gölgeyi motor kendi çiziyor** (gündüz/geceyle döner). O yüzden sprite'larda
  **zemin gölgesi OLMAYACAK**, arka plan **tam şeffaf** olacak.
- Sprite'lar oyunda küçülür (karakter ~56px, bina ~60-75px yüksekliğe iner). Bu
  yüzden **net siluet, okunaklı büyük şekiller** şart; minik ayrıntı ve yazı kaybolur.

## 1. ÇALIŞMA YÖNTEMİ (önemli — tutarlılık böyle sağlanır)

1. **Önce STİL ÇAPASI üret.** Aşağıdaki "Kahraman (hero)" ve "Köy Konağı" promptlarını
   üret. Beğendiğin sonucu **referans görsel** olarak sakla.
2. Sonraki her üretimde Nano Banana Pro'ya o çapayı da ver ve "**bu referansla aynı
   sanat stili, ışık, renk tonu ve çizim kalınlığında**" de. Cohesif set böyle çıkar.
3. Her görseli **ilgili klasöre, tam belirtilen dosya adıyla** koy (dosya adları
   koddaki anahtarlarla birebir — entegrasyon böyle otomatik olur).
4. Format: **PNG, şeffaf arka plan, kare (1:1) veya uzun nesneler için 2:3**, en yüksek çözünürlük.

## 2. STİL İNCİLİ (her prompta bunu ekle ya da referans görselle koru)

> **STYLE:** Hand-painted 2.5D mobile game asset, storybook painterly illustration,
> semi-realistic stylized proportions with a warm heroic fantasy feel. Soft
> painterly brushwork, clean readable shapes, rich but natural earthy color grade
> (Anatolian / Turkic medieval-fantasy). Warm key light from the upper-left, soft
> ambient fill, subtle rim light — **consistent light direction on every asset.**
> Viewed from a **high 3/4 top-down angle, ~50° above the horizon**, like looking
> down at a handcrafted tabletop diorama. **Isolated on a fully transparent
> background (alpha), NO ground plane, NO cast/drop shadow.** Bold silhouette, high
> clarity, stays readable when scaled down to a small in-game sprite; avoid tiny
> fussy detail, avoid any text or letters. Highest resolution, PNG with alpha.

**Karakterler için ek satır (her karakter promptuna ekle):**

> **CHARACTER FRAMING:** Full-body single character, seen from above at a 3/4
> angle, body oriented toward the viewer and **facing screen-RIGHT (east)**,
> neutral idle stance. Slightly large head / heroic mobile-game proportions.
> Feet touching the **bottom-center** of the frame, small margin on the sides and
> top. (We mirror it in-engine for left-facing — do not add a second pose.)

**Binalar/çevre için ek satır:**

> **PROP FRAMING:** Single object centered, its base touching the bottom-center of
> the frame. Front 3/4 view (front wall + a bit of roof visible), matching the
> billboard diorama look. No terrain under it.

---

## 3. KLASÖR YAPISI ve DOSYA ADLARI

Görselleri şu klasörlere, tam bu adlarla koy (`.png`):

```
assets/sprites/
  characters/   hero, soldier_sword, soldier_bow, soldier_shield,
                villager_axe, villager_pick, villager_crowbar, villager_idle,
                cmd_vulkar, cmd_kaya, cmd_marius
  enemies/      barb, brute, guard, archer, shieldbarb, shaman, wram,
                legion, chief, commander, rivallord
  beasts/       wolf, bear, troll, deer, boar, rabbit
  buildings/    campfire (=Köy Konağı), sawmill, blacksmith, barracks,
                watchtower, house, siege, hunter, depot, ruined
  walls/        palisade_post, stonewall_seg, keep_wall_seg, keep_tower,
                gate_village, gate_fort, gate_legion, gate_outpost, banner
  siege/        ram, ballista, catapult
  environment/  tree, tree_stump, rock, rock_depleted, scrap, cave,
                merchant_camel, tent, totem, column, column_fallen, grave
  ground/       (opsiyonel, tileable dokular) sand, grass, snow, water, path
```

> **IRK VARYANTLARI (önemli — 300 görsel üretme!):** Oyunda 11 ırk var (barbar,
> mızraklı, çöl, atlı, samuray, kurt klanı, gladyatör, gölge, taş soyu, ateş,
> orman, buz) ve her biri temel düşmanı farklı kıyafet rengi + silahla yeniden
> renklendiriyor. Bunları TEK TEK üretme. Temel barbar setini üret; ırk renklerini
> **kodda tint (renklendirme) ile** uygularız (motor zaten her ırkın `cloth`
> rengini biliyor). İstersen sadece "imza silahları" (mızrak, kılıç/scimitar,
> katana, trident, pençe, topuz, hançer) için ayrı küçük görseller üret — onları
> kahramanın eline bindiririz. Bu, seti ~45 görselde tutar.

---

## 4. KARAKTERLER  →  `assets/sprites/characters/`

Hepsine **STYLE İNCİLİ + CHARACTER FRAMING** ekle.

### hero.png — Oyuncu (kahraman, köyün lideri)
> A heroic young Anatolian warlord, the leader who rebuilds a burned village.
> Weathered leather-and-cloth armor with a **teal-green cloak/tunic** and a wide
> leather belt, fur trim on the shoulders, a short sword sheathed at the hip.
> Determined, capable, rugged but not grim. Warm skin, dark hair.

### soldier_sword.png — Kılıçlı asker
> A disciplined footman soldier in **blue-grey padded armor** with a plain steel
> helmet and leather belt, holding a short sword and a small round shield.
> Balanced melee fighter, uniform look (rank-and-file).

### soldier_bow.png — Okçu asker
> A light archer in **blue-grey leather armor**, steel cap, holding a wooden
> **recurve bow**, a quiver on the back. Lean and quick, less armored than the
> swordsman.

### soldier_shield.png — Kalkanlı asker
> A heavy shieldbearer in **blue armor**, steel helmet, carrying a large rounded
> **tower shield** and a short mace. Broad, sturdy, defensive stance.

### villager_axe.png — Oduncu köylü
> A humble village woodcutter in simple brown/cream peasant clothes, sleeves
> rolled, holding a **woodcutting axe** over the shoulder. Friendly, hardworking,
> no armor.

### villager_pick.png — Taşçı köylü
> Same peasant style as the woodcutter but holding a **mining pickaxe**. Slightly
> dusty clothes.

### villager_crowbar.png — Hurdacı köylü
> Same peasant style, holding a **metal crowbar / pry-bar**, a few scrap-metal
> bits at the belt.

### villager_idle.png — Boştaki köylü (aletsiz)
> Same peasant style, empty hands, relaxed idle pose. (Kadın/erkek karışık köy
> hissi için bunu bir kadın köylü yapabilirsin.)

### cmd_vulkar.png — Kara Vulkar (isimli komutan / Savaş Lordu)
> An imposing barbarian **war-lord** boss-turned-ally. Dark **purple-black** heavy
> armor with jagged pauldrons, a **skull motif** on the chest, a bone-and-iron
> crest, wielding a large brutal blade. Menacing, powerful, elite silhouette.

### cmd_kaya.png — Şef Kaya (Kale Şefi)
> A grizzled fortress chieftain in **dark iron-grey** armor with a red crest,
> carrying a big **two-handed war-axe**, fur mantle. Broad, veteran, commanding.

### cmd_marius.png — Marius (Lejyon Komutanı)
> A legion commander in **deep-red lamellar armor** with a silver-white crest and
> an **eagle motif** on the shoulder, holding a spear/gladius. Roman-legion
> inspired, proud and disciplined.

---

## 5. DÜŞMANLAR  →  `assets/sprites/enemies/`

**STYLE + CHARACTER FRAMING** ekle. Bunlar barbar/vahşi taraf: kaba, koyu, tehditkâr.
Her düşmanın **ayaklarının altına düşman hissi** için hafif kızıllık vermene gerek yok
(motor kızıl halkayı ekliyor).

### barb.png — Barbar (sıradan asker, en yaygın)
> A common barbarian raider, lean and wiry, **reddish-brown ragged clothing** and
> hide wraps, a crude short sword or hand-axe, unkempt hair. Small, expendable,
> aggressive.

### brute.png — Kaba Kuvvet (iri barbar)
> A big heavy barbarian brute, **dark brown hides**, bare muscular arms, a large
> crude club or cleaver. Bulky, ~30% taller and wider than a normal barb.

### guard.png — Muhafız (zırhlı)
> An armored camp guard in **dark grey-blue plate scraps** and a horned iron helm,
> carrying a spear and shield. More armored and disciplined than a barb.

### archer.png — Barbar okçusu
> A skirmisher archer, **tan/olive rags**, hood, holding a crude short bow, quiver
> of arrows. Small and fragile, keeps distance.

### shieldbarb.png — Kalkanlı barbar
> A barbarian in **tan hides** carrying a big rough **wooden plank shield** (bound
> with iron), a short axe. Defensive, shield covers the body.

### shaman.png — Şaman (iyileştirici — önce onu öldür!)
> A tribal witch-shaman in **teal-green robes** and a bone/feather mask, holding a
> gnarled **wooden staff topped with a glowing green orb**. Mystical, sinister,
> clearly a support caster.

### wram.png — Barbar koçbaşçısı (kapı kırar)
> A hulking barbarian carrying a **battering log / ram on the shoulder**, heavy
> brown hides, iron-banded arms. Slow but devastating. (Log dikey değil, omuzda taşınır gibi.)

### legion.png — Lejyoner (düşman elit)
> An enemy legionnaire in **dark crimson lamellar armor**, iron helm, short sword
> and rectangular shield. Disciplined heavy infantry (Marius'un ordusu).

### chief.png — Kale Şefi (BOSS, dev)
> A massive barbarian **boss chieftain**, ~1.5× normal size, **charcoal-grey
> heavy armor**, huge horned helm, a giant two-handed axe, war-paint, trophy
> bones. Terrifying elite silhouette, boss-tier.

### commander.png — Lejyon Komutanı (BOSS, dev)
> A giant enemy **legion boss-commander**, ~1.6× size, **deep-blood-red ornate
> armor**, tall crested helm, greatsword, cape. Roman boss-tier, imposing.

### rivallord.png — Kara Vulkar boss formu (BOSS)
> The rival warlord as a **raid boss**, ~1.55× size, **dark purple-black spiked
> armor**, skull crest, glowing eyes, a massive cleaver wreathed in embers.
> (Bu, cmd_vulkar'ın daha büyük, daha korkunç boss hali.)

---

## 6. HAYVANLAR & CANAVARLAR  →  `assets/sprites/beasts/`

**STYLE** ekle; bunlar 4 ayaklı, yandan 3/4 profil, **sağa bakar** (aynalanır).

### wolf.png — Kurt (gece köye iner)
> A lean grey **wolf**, side 3/4 view facing right, bristled fur, yellow eyes,
> snarling slightly. Fast predator.

### bear.png — Mağara Ayısı (BOSS)
> A huge brown **cave bear** boss, ~1.75× size, massive shoulders, scars, raised
> aggressive posture. Side 3/4 facing right.

### troll.png — Trol (gezen dünya boss'u, en büyük)
> A giant mossy **forest troll** boss, ~2.3× size, green-grey rocky skin, huge
> arms, a torn tree-trunk club. Hunched, monstrous. Side 3/4 facing right.

### deer.png — Geyik (avlanır, et verir)
> A gentle brown **deer/stag** with antlers, side 3/4 facing right, calm. Wildlife.

### boar.png — Yaban domuzu
> A dark brown **wild boar** with tusks and a bristled back ridge, side 3/4 facing
> right. Stocky.

### rabbit.png — Tavşan (küçük yaban hayatı)
> A small cream-grey **rabbit** with long ears, side 3/4 facing right. Tiny, cute.

---

## 7. BİNALAR  →  `assets/sprites/buildings/`

**STYLE + PROP FRAMING** ekle. Oyuncunun binaları referans-2'nin **mavi çatılı,
boyalı köy** hissinde olmalı (tutarlı: bizim köy konağının çatısı zaten mavi).

### campfire.png — Köy Konağı (merkez bina, en önemli)
> The central **village hall / keep** of a rebuilt Anatolian village. Stone ground
> floor + timber-framed upper floor, a **steep blue shingled roof**, warm glowing
> windows, a tall pole with a **blue pennant flag** on top, a small stone
> fire-hearth in front. Cozy, hopeful, the heart of the village. The nicest,
> most detailed building. (Referans 2'nin mavi çatılı evleri gibi.)

### sawmill.png — Bıçkıhane
> A rustic **sawmill** workshop: timber walls, a **warm amber/brown roof**, stacked
> logs, a large saw-blade or saw-buck out front, wood shavings.

### blacksmith.png — Demirci
> A **blacksmith** forge: stone-and-timber walls, a **dark red-brown roof**, a
> chimney with a glowing forge inside, an anvil and hammer out front, sparks.

### barracks.png — Kışla
> A **barracks**: sturdy timber walls, a **blue-grey roof**, a weapon rack with
> spears/shields out front, a small training dummy. Military but tidy.

### watchtower.png — Gözcü Kulesi (uzun/dar)
> A tall slim **watchtower**: stone shaft, a wooden platform near the top with a
> **grey pointed roof** and a crenellation slit, an archer's post. Taller than
> wide (2:3 dikey frame).

### house.png — Köylü Evi
> A small cozy **peasant cottage**: timber-and-plaster walls, a **blue shingled
> roof**, a little chimney, a barrel and a hay bale beside the door. (Referans 2
> stilinin tam karşılığı.)

### siege.png — Kuşatma Atölyesi
> A heavy **siege workshop**: big open timber shed, a **brown roof**, a
> half-built catapult frame and stacked timber/iron inside, ropes and gears.

### hunter.png — Avcı Kulübesi
> A small **hunter's hut**: log walls, a **green mossy roof**, drying hides and
> antlers on the wall, a bow leaning by the door.

### depot.png — Depo
> A **storehouse/depot**: timber walls, a **tan roof**, an open front showing
> stacked crates, sacks of grain and barrels.

### ruined.png — Yıkık bina (genel hasarlı hali)
> A **destroyed/ruined building**: collapsed timber frame, broken charred beams,
> a caved-in roof, rubble and scattered stones, faint smoke. Generic (used for
> any damaged building). Warm ash tones.

---

## 8. SURLAR, KAPILAR, SANCAK  →  `assets/sprites/walls/`

**STYLE + PROP FRAMING** ekle. Bunlar **modüler parça** — motor bunları yan yana
dizerek sur örer. O yüzden **tek bir kısa segment** üret, kenarları bitişebilir olsun.

### palisade_post.png — Ahşap kazık suru (tek segment)
> A short segment of a **wooden palisade wall**: 3-4 sharpened vertical timber
> stakes lashed with rope, weathered wood. Tileable edges (left/right can repeat).

### stonewall_seg.png — Taş sur (tek segment)
> A short segment of a **grey stone rampart wall** with a crenellated top,
> moss in the cracks. Tileable edges.

### keep_wall_seg.png — Kale suru (tek segment, daha yüksek/kalın)
> A short segment of a tall thick **castle keep wall**: dressed grey stone,
> battlements on top, arrow slits. Tileable edges. Heavier than stonewall_seg.

### keep_tower.png — Kale köşe kulesi
> A **round stone corner tower** of a castle keep, conical grey roof, battlements,
> arrow slits. Sits at wall corners.

### gate_village.png — Köy kapısı (ahşap, kırılabilir)
> A **wooden village gate**: two timber doors bound with iron, a sturdy frame,
> standing open. Also imagine it fits between palisade stakes.

### gate_fort.png — Kale kapısı
> A heavier **fortress gate**: iron-banded oak doors in a stone archway, portcullis
> hints. Standing open.

### gate_legion.png — Lejyon çelik kapısı (en sağlam)
> A massive **steel legion gate**: dark riveted iron doors in a tall stone arch,
> crimson banners on the sides. Imposing, the toughest gate.

### gate_outpost.png — Karakol kapısı (ahşap, sade)
> A simple **outpost gate**: light timber double-door matching the palisade style,
> a small banner above.

### banner.png — Sancak / bayrak direği (karakol fethedilince dikilir)
> A tall wooden **banner pole planted in the ground** with a **blue pennant flag**
> waving, a small stone base. Marks a captured outpost. (Uzun/dikey.)

---

## 9. KUŞATMA MAKİNELERİ  →  `assets/sprites/siege/`

**STYLE + PROP FRAMING** ekle.

### ram.png — Koçbaşı
> A **battering ram** on wheels: a heavy iron-capped log slung under a timber
> A-frame with a small roof, ropes. Facing right.

### ballista.png — Balista
> A large mounted **ballista** (giant crossbow) on a wooden base, a heavy iron
> bolt loaded, torsion ropes. Facing right.

### catapult.png — Mancınık
> A wooden **catapult / onager** with a loaded throwing arm and counterweight,
> reinforced timber frame, on wheels. Facing right.

---

## 10. ÇEVRE ELEMANLARI  →  `assets/sprites/environment/`

**STYLE + PROP FRAMING** ekle.

### tree.png — Ağaç (kaynak: odun)
> A lush stylized **broadleaf tree**, rounded painterly canopy in warm greens, a
> sturdy brown trunk. Storybook shape. (Kar/çöl biyomları için rengi kodda
> ayarlanabilir; sen yeşil ve dolgun yap.)

### tree_stump.png — Kütük (kesilmiş ağaç)
> A freshly cut **tree stump** with visible rings and a few wood chips around it.
> Small.

### rock.png — Kaya (kaynak: taş)
> A chunky **grey boulder cluster**, faceted painterly rock with lighter top
> highlights. Mineable look.

### rock_depleted.png — Tükenmiş kaya
> A small pile of **broken grey rubble / gravel**, the leftover after mining.

### scrap.png — Hurda yığını (kaynak: metal)
> A **pile of rusty scrap metal**: bent iron bars, a broken wheel rim, old plates,
> reddish rust. Salvage.

### cave.png — Mağara girişi (hazine/zindan)
> A **cave entrance** in a rocky purple-grey hillside: a dark arched mouth, a few
> stalactites, faint teal crystal glow and a hint of gold treasure light from
> inside, mossy stones. Mysterious, inviting.

### merchant_camel.png — Göçebe Tüccar (deve + tüccar)
> A friendly **nomad merchant standing beside a laden camel**: colorful blankets
> and trade goods, sacks and pots on the camel's back, a small awning. Warm
> desert-trader vibe. (Deve + tüccar tek görselde.)

### tent.png — Barbar çadırı (düşman kampı)
> A rough **barbarian hide tent**: animal skins over a timber frame, a crude
> banner, bones and a small campfire ring beside it. Dark, tribal.

### totem.png — Barbar totemi (kampın yok etme hedefi)
> A menacing tribal **totem pole**: stacked carved wooden faces, a skull on top,
> feathers, bones and war-paint, a faint dark aura. The heart of a barbarian camp.

### column.png — Antik sütun (harabeler)
> A weathered **ancient stone column**, cream marble, fluted shaft, cracked
> capital. Ruins prop.

### column_fallen.png — Devrilmiş sütun
> A **toppled broken column** lying in segments on the ground, cracked marble,
> overgrown with a little moss.

### grave.png — Mezar
> A simple **grave/headstone**: a weathered stone marker, a small mound, a few
> wildflowers. Somber.

---

## 11. ZEMİN DOKULARI (opsiyonel)  →  `assets/sprites/ground/`

Bunlar **tileable (kenarları bitişen) tekrar dokusu**, kuşbakışı düz.
> **GROUND STYLE:** Seamless tileable top-down ground texture, hand-painted, soft
> and readable, no objects, no shadows, edges wrap seamlessly. Square.

- `sand.png` — warm desert sand with subtle dunes and pebbles
- `grass.png` — lush green-gold steppe grass with tiny flowers
- `snow.png` — soft snow with faint blue shadows and ice patches
- `water.png` — shallow turquoise water with gentle painterly ripples
- `path.png` — packed-dirt road/path, warm brown, faint wheel tracks

> Not: Zemin şu an prosedürel çiziliyor. İstersen bunları atlayabiliriz; en büyük
> görsel kazanç karakter + bina + çevre sprite'larından gelir. Zemini sonra ele alalım.

---

## 12. ÖNCELİK SIRASI (sınırlı zamanın varsa)

1. **hero, campfire (Köy Konağı), house, tree, rock** → stil çapası + en çok görünen 5 şey.
2. Askerler (3) + köylüler (4) + en yaygın düşmanlar (barb, brute, archer).
3. Kalan binalar + surlar/kapılar.
4. Boss'lar (chief, commander, rivallord, bear, troll) + komutanlar (3).
5. Kuşatma makineleri, çevre süsleri, zemin dokuları.

Her partiyi ürettikçe klasöre koy ve bana haber ver — ben o partiyi oyuna bağlayıp
canlıya alayım, böylece adım adım ilerleyip her seferinde sonucu görürüz.

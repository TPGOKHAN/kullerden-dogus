// ============================================================================
// KÜLLERDEN DOĞUŞ — YAYINLANMIŞ DÜNYA YAPILANDIRMASI
// ----------------------------------------------------------------------------
// Bu dosya admin panelindeki "📤 Yayına hazırla" düğmesiyle üretilir ve depoya
// işlenir. Oyunu açan HERKES (eş, misafir, yeni cihaz) bu ayarları görür.
//
// Öncelik sırası:
//   1) Yerel tarayıcı ayarları (localStorage) — sadece admin makinesinde,
//      yayınlamadan önce denemek için
//   2) BU DOSYA — yayındaki resmî ayar, herkeste geçerli
//   3) Oyunun varsayılanları
//
// NOT (co-op): dünya üretimi iki oyuncuda da AYNI olmalı. Bu yüzden ayarlar
// sunucudan canlı çekilmiyor, sürümle birlikte dağıtılıyor — iki taraf da aynı
// dağıtımı aldığı sürece dünyaları birebir aynı olur.
// ============================================================================
window.KD_CONFIG = {
  maps: {},      // harita düzenleyicideki yerleşke konumları (düzen indeksine göre)
  skin: {},      // görünüm paleti (ırk renkleri, çatılar, tema)
  balance: {},   // ekonomi/denge katsayıları
  worlds: {},    // vilayete özel dünya yerleşimi (kd-admin-world-<provId>)
};

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// =============================================
// BİLGİLER
// =============================================
const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE     = "153759";
const ULTRAMSG_URL          = "https://api.ultramsg.com/instance174194";
const ULTRAMSG_TOKEN        = "7wwhgbrsha8qtzqd";
const GRUP_ID               = "120363426448176462@g.us";
// =============================================

let oturumCookie = null;

// Kolay Gelsin'e giriş yap ve cookie al
async function girisYap() {
  try {
    const response = await axios.post(
      "https://kurumsal.kolaygelsin.com/api/auth/login",
      { username: KOLAYGELSIN_KULLANICI, password: KOLAYGELSIN_SIFRE },
      { headers: { "Content-Type": "application/json" } }
    );
    const cookies = response.headers["set-cookie"];
    if (cookies) {
      oturumCookie = cookies.map(c => c.split(";")[0]).join("; ");
      console.log("✅ Giriş başarılı!");
      return true;
    }
    // Token tabanlı auth dene
    if (response.data?.token || response.data?.access_token) {
      oturumCookie = `Bearer ${response.data.token || response.data.access_token}`;
      console.log("✅ Token alındı!");
      return true;
    }
  } catch (hata) {
    console.log("⚠️ API girişi başarısız, form girişi deneniyor...");
  }

  // Form tabanlı giriş dene
  try {
    const formData = new URLSearchParams();
    formData.append("username", KOLAYGELSIN_KULLANICI);
    formData.append("password", KOLAYGELSIN_SIFRE);

    const response = await axios.post(
      "https://kurumsal.kolaygelsin.com/login",
      formData.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        maxRedirects: 5,
        withCredentials: true,
      }
    );
    const cookies = response.headers["set-cookie"];
    if (cookies) {
      oturumCookie = cookies.map(c => c.split(";")[0]).join("; ");
      console.log("✅ Form girişi başarılı!");
      return true;
    }
  } catch (hata) {
    console.error("❌ Giriş hatası:", hata.message);
  }
  return false;
}

// Gönderi bilgisi çek
async function gonderiGetir(gonderiNo) {
  // Oturum yoksa giriş yap
  if (!oturumCookie) {
    const girisOk = await girisYap();
    if (!girisOk) throw new Error("Kolay Gelsin'e giriş yapılamadı!");
  }

  // API endpoint'lerini dene
  const endpointler = [
    `https://kurumsal.kolaygelsin.com/api/shipments/${gonderiNo}`,
    `https://kurumsal.kolaygelsin.com/api/shipment/search?q=${gonderiNo}`,
    `https://kurumsal.kolaygelsin.com/api/v1/shipments?trackingNumber=${gonderiNo}`,
  ];

  for (const url of endpointler) {
    try {
      const res = await axios.get(url, {
        headers: {
          "Cookie": oturumCookie,
          "Authorization": oturumCookie.startsWith("Bearer") ? oturumCookie : undefined,
        },
        timeout: 10000,
      });

      console.log(`📦 API cevabı (${url}):`, JSON.stringify(res.data).substring(0, 500));

      // Cevaptan bilgi çek
      const data = res.data;
      let adSoyad = "";
      let telefon = "";

      // Farklı formatlara göre çek
      if (data?.receiver?.name) adSoyad = data.receiver.name;
      else if (data?.aliciAdi) adSoyad = data.aliciAdi;
      else if (data?.receiverName) adSoyad = data.receiverName;
      else if (data?.data?.receiverName) adSoyad = data.data.receiverName;
      else if (Array.isArray(data) && data[0]?.receiverName) adSoyad = data[0].receiverName;

      if (data?.receiver?.phone) telefon = data.receiver.phone;
      else if (data?.aliciTelefon) telefon = data.aliciTelefon;
      else if (data?.receiverPhone) telefon = data.receiverPhone;
      else if (data?.data?.receiverPhone) telefon = data.data.receiverPhone;
      else if (Array.isArray(data) && data[0]?.receiverPhone) telefon = data[0].receiverPhone;

      if (adSoyad || telefon) {
        return { adSoyad, telefon };
      }
    } catch (hata) {
      console.log(`⚠️ ${url} başarısız:`, hata.message);
      if (hata.response?.status === 401) {
        oturumCookie = null; // Oturum süresi dolmuş
      }
    }
  }

  // Tüm endpointler başarısız — sayfa scraping dene
  return await sayfadanCek(gonderiNo);
}

// Son çare: sayfa içeriğinden çek
async function sayfadanCek(gonderiNo) {
  try {
    const res = await axios.get(
      `https://kurumsal.kolaygelsin.com/pages/shipment-search?q=${gonderiNo}`,
      {
        headers: { "Cookie": oturumCookie },
        timeout: 15000,
      }
    );

    const html = res.data;
    console.log("📄 Sayfa HTML (ilk 1000):", html.substring(0, 1000));

    // Telefon numarası çek
    const telMatch = html.match(/5\d{9}/g);
    const telefon = telMatch ? "0" + telMatch[0] : null;

    // İsim çek
    let adSoyad = null;
    const isimMatch = html.match(/alıcı[^>]*>([^<]+)/i) ||
                      html.match(/"receiverName"\s*:\s*"([^"]+)"/i) ||
                      html.match(/"aliciAdi"\s*:\s*"([^"]+)"/i);
    if (isimMatch) adSoyad = isimMatch[1].trim();

    return { adSoyad, telefon };
  } catch (hata) {
    console.error("❌ Sayfa hatası:", hata.message);
    return { adSoyad: null, telefon: null };
  }
}

// =============================================
// KUYRUK SİSTEMİ
// =============================================
const kuyruk = [];
let islemDevamEdiyor = false;

function kuyrugaEkle(gonderiNo, mesajId) {
  if (kuyruk.find(k => k.gonderiNo === gonderiNo)) return false;
  kuyruk.push({ gonderiNo, mesajId });
  return true;
}

async function kuyrukIsle() {
  if (islemDevamEdiyor || kuyruk.length === 0) return;
  islemDevamEdiyor = true;

  while (kuyruk.length > 0) {
    const { gonderiNo, mesajId } = kuyruk.shift();
    console.log(`🔄 İşleniyor: ${gonderiNo}`);

    try {
      const kalanMesaj = kuyruk.length > 0 ? `_(Sırada ${kuyruk.length} sorgu daha var)_` : "";
      await mesajaReplyAt(mesajId, `🔍 Sorgulanıyor... ${kalanMesaj}`);

      const bilgi = await gonderiGetir(gonderiNo);

      if (bilgi.adSoyad || bilgi.telefon) {
        await mesajaReplyAt(mesajId,
          `📦 *Gönderi No:* ${gonderiNo}\n` +
          `👤 *Ad Soyad:* ${bilgi.adSoyad || "Bulunamadı"}\n` +
          `📞 *Telefon:* ${bilgi.telefon || "Bulunamadı"}`
        );
      } else {
        await mesajaReplyAt(mesajId, `❌ *${gonderiNo}* için bilgi bulunamadı.`);
      }
    } catch (hata) {
      console.error(`❌ Hata:`, hata.message);
      await mesajaReplyAt(mesajId, `⚠️ Hata: ${hata.message}`);
    }

    await bekle(1000);
  }

  islemDevamEdiyor = false;
}

async function mesajaReplyAt(mesajId, mesaj) {
  await axios.post(`${ULTRAMSG_URL}/messages/chat`, {
    token: ULTRAMSG_TOKEN,
    to: GRUP_ID,
    body: mesaj,
    quotedMsgId: mesajId,
  });
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.event_type !== "message_received") return;
    const mesaj = body.data?.body?.trim();
    if (!mesaj) return;
    const mesajId = body.data?.id;
    const grupId = body.data?.from;
    if (!grupId?.includes("@g.us")) return;

    const gonderiNo = mesaj.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (gonderiNo.length < 6 || gonderiNo.length > 25) return;

    const eklendi = kuyrugaEkle(gonderiNo, mesajId);
    if (eklendi && kuyruk.length > 1) {
      await mesajaReplyAt(mesajId, `⏳ Kuyruğa alındı. Sıra: *${kuyruk.length}*`);
    }
    kuyrukIsle();
  } catch (hata) {
    console.error("Webhook hatası:", hata.message);
  }
});

function bekle(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Başlangıçta giriş yap
girisYap();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Kurye botu çalışıyor! Port: ${PORT}`));

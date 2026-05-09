const express = require("express");
const axios = require("axios");
const puppeteer = require("puppeteer");

const app = express();
app.use(express.json());

// =============================================
// BURAYA KENDİ BİLGİLERİNİ GİR
// =============================================
const KOLAYGELSIN_KULLANICI = "BURAYA_KULLANICI_ADI_YAZ";
const KOLAYGELSIN_SIFRE     = "BURAYA_SIFRE_YAZ";
const GREEN_API_INSTANCE    = "BURAYA_INSTANCE_ID_YAZ";
const GREEN_API_TOKEN       = "BURAYA_API_TOKEN_YAZ";
const GRUP_ID               = "BURAYA_GRUP_ID_YAZ";
// =============================================

// =============================================
// KUYRUK SİSTEMİ
// =============================================
const kuyruk = [];
let islemDevamEdiyor = false;

function kuyrugaEkle(gonderiNo, mesajId) {
  const zatenVar = kuyruk.find((k) => k.gonderiNo === gonderiNo);
  if (zatenVar) {
    console.log(`⚠️  ${gonderiNo} zaten kuyrukta, atlandı.`);
    return false;
  }
  kuyruk.push({ gonderiNo, mesajId, zaman: Date.now() });
  console.log(`➕ Kuyruğa eklendi: ${gonderiNo} | Toplam: ${kuyruk.length}`);
  return true;
}

async function kuyrukIsle() {
  if (islemDevamEdiyor || kuyruk.length === 0) return;
  islemDevamEdiyor = true;

  while (kuyruk.length > 0) {
    const { gonderiNo, mesajId } = kuyruk.shift();
    console.log(`🔄 İşleniyor: ${gonderiNo} | Kalan: ${kuyruk.length}`);

    try {
      const kalanMesaj = kuyruk.length > 0
        ? `_(Sırada ${kuyruk.length} sorgu daha var)_`
        : "";

      await mesajaReplyAt(mesajId, `🔍 Sorgulanıyor... ${kalanMesaj}`);

      const bilgi = await gonderiGetir(gonderiNo);

      if (bilgi.adSoyad || bilgi.telefon) {
        await mesajaReplyAt(
          mesajId,
          `📦 *Gönderi No:* ${gonderiNo}\n` +
          `👤 *Ad Soyad:* ${bilgi.adSoyad || "Bulunamadı"}\n` +
          `📞 *Telefon:* ${bilgi.telefon || "Bulunamadı"}`
        );
      } else {
        await mesajaReplyAt(mesajId, `❌ *${gonderiNo}* için bilgi bulunamadı.`);
      }
    } catch (hata) {
      console.error(`❌ Hata (${gonderiNo}):`, hata.message);
      await mesajaReplyAt(mesajId, `⚠️ *${gonderiNo}* sorgulanırken hata oluştu.`);
    }

    await bekle(2000);
  }

  islemDevamEdiyor = false;
  console.log("✅ Tüm kuyruk tamamlandı.");
}

// =============================================
// KOLAY GELSİN — GÖNDERİ TAKİP SAYFASINDAN BİLGİ ÇEK
// =============================================
async function gonderiGetir(gonderiNo) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // 1. Giriş sayfasına git
    await page.goto("https://kurumsal.kolaygelsin.com/login", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // 2. Kullanıcı adı ve şifre gir
    await page.waitForSelector('input[name="username"], input[placeholder*="kullanıcı"], input[placeholder*="Kullanıcı"], input[type="text"]');
    await page.type('input[name="username"], input[placeholder*="kullanıcı"], input[placeholder*="Kullanıcı"], input[type="text"]', KOLAYGELSIN_KULLANICI);
    await page.type('input[type="password"]', KOLAYGELSIN_SIFRE);
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });

    // 3. Gönderi Takip sayfasına git
    await page.goto("https://kurumsal.kolaygelsin.com/pages/shipment-search", {
      waitUntil: "networkidle2",
      timeout: 20000,
    });

    await bekle(2000);

    // 4. "Gönderi Takip Numarası" kutusunu bul ve gönderi numarasını yaz
    await page.waitForSelector('input', { timeout: 10000 });

    // Sayfadaki ilk input kutusu "Gönderi Takip Numarası"
    const inputlar = await page.$$('input[type="text"], input:not([type="password"])');
    if (inputlar.length > 0) {
      await inputlar[0].click();
      await inputlar[0].type(gonderiNo);
    }

    // 5. Ara butonuna tıkla
    await page.evaluate(() => {
      const butonlar = Array.from(document.querySelectorAll("button"));
      const araButon = butonlar.find(
        (b) =>
          b.innerText.toLowerCase().includes("ara") ||
          b.innerText.toLowerCase().includes("sorgula") ||
          b.innerText.toLowerCase().includes("search")
      );
      if (araButon) araButon.click();
    });

    await bekle(3000);

    // 6. Sayfadan müşteri adı ve telefon çek
    const bilgiler = await page.evaluate(() => {
      const tumMetin = document.body.innerText;

      // Telefon numarası bul
      const telRegex = /(\+90|0)[\s\-]?(5\d{2})[\s\-]?(\d{3})[\s\-]?(\d{2})[\s\-]?(\d{2})/g;
      const telefonlar = [];
      let eslesen;
      while ((eslesen = telRegex.exec(tumMetin)) !== null) {
        telefonlar.push(eslesen[0].replace(/[\s\-]/g, ""));
      }

      // Ad Soyad bul
      let adSoyad = "";
      const satirlar = tumMetin.split("\n");
      for (let i = 0; i < satirlar.length; i++) {
        const satir = satirlar[i].trim();
        if (
          satir.toLowerCase().includes("alıcı") ||
          satir.toLowerCase().includes("müşteri adı") ||
          satir.toLowerCase().includes("ad soyad") ||
          satir.toLowerCase().includes("teslim edilecek")
        ) {
          if (satirlar[i + 1] && satirlar[i + 1].trim().length > 2) {
            adSoyad = satirlar[i + 1].trim();
            break;
          }
        }
      }

      return {
        telefon: telefonlar[0] || null,
        adSoyad: adSoyad || null,
        tumMetin: tumMetin.substring(0, 3000),
      };
    });

    console.log("📄 Sayfa içeriği (ilk 500 karakter):", bilgiler.tumMetin.substring(0, 500));

    await browser.close();
    return bilgiler;

  } catch (hata) {
    await browser.close();
    throw hata;
  }
}

// =============================================
// GREEN API — MESAJA REPLY AT
// =============================================
async function mesajaReplyAt(mesajId, mesaj) {
  const url = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`;
  await axios.post(url, {
    chatId: GRUP_ID,
    message: mesaj,
    quotedMessageId: mesajId,
  });
}

// =============================================
// WEBHOOK — GRUPTAN GELEN MESAJLARI DİNLE
// =============================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    if (body.typeWebhook !== "incomingMessageReceived") return;
    if (!body.senderData?.chatId?.includes("@g.us")) return;

    const mesaj = body.messageData?.textMessageData?.textMessage?.trim();
    if (!mesaj) return;

    const mesajId = body.idMessage;

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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Kurye botu çalışıyor! Port: ${PORT}`));

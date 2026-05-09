const express = require("express");
const axios = require("axios");
const puppeteer = require("puppeteer");

const app = express();
app.use(express.json());

// =============================================
// BURAYA KENDİ BİLGİLERİNİ GİR
// =============================================
const KOLAYGELSIN_KULLANICI = "seyhanbs";
const KOLAYGELSIN_SIFRE     = "153759";
const ULTRAMSG_URL          = "https://api.ultramsg.com/instance174194";
const ULTRAMSG_TOKEN        = "7wwhgbrsha8qtzqd";
const GRUP_ID               = "120363426448176462@g.us";
// =============================================

const kuyruk = [];
let islemDevamEdiyor = false;

function kuyrugaEkle(gonderiNo, mesajId) {
  const zatenVar = kuyruk.find((k) => k.gonderiNo === gonderiNo);
  if (zatenVar) return false;
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
      await mesajaReplyAt(mesajId, `⚠️ Hata oluştu: ${hata.message}`);
    }

    await bekle(2000);
  }

  islemDevamEdiyor = false;
}

async function gonderiGetir(gonderiNo) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // 1. Giriş yap
    await page.goto("https://kurumsal.kolaygelsin.com/login", {
      waitUntil: "networkidle2", timeout: 30000,
    });

    await page.waitForSelector('input[type="text"], input[name="username"]');
    const inputs = await page.$$('input');
    await inputs[0].type(KOLAYGELSIN_KULLANICI);
    await inputs[1].type(KOLAYGELSIN_SIFRE);
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 });

    // 2. Gönderi takip sayfasına git
    await page.goto("https://kurumsal.kolaygelsin.com/pages/shipment-search", {
      waitUntil: "networkidle2", timeout: 20000,
    });
    await bekle(2000);

    // 3. Gönderi numarasını gir
    const inputlar = await page.$$('input[type="text"]');
    if (inputlar.length > 0) {
      await inputlar[0].click({ clickCount: 3 });
      await inputlar[0].type(gonderiNo);
    }

    // 4. Filtrele butonuna tıkla
    await page.evaluate(() => {
      const butonlar = Array.from(document.querySelectorAll("button, input[type='submit']"));
      const btn = butonlar.find(b =>
        b.innerText?.toLowerCase().includes("filtrele") ||
        b.innerText?.toLowerCase().includes("ara") ||
        b.value?.toLowerCase().includes("filtrele")
      );
      if (btn) btn.click();
    });

    await bekle(3000);

    // 5. "Ayrıntılar" butonuna tıkla
    await page.evaluate(() => {
      const butonlar = Array.from(document.querySelectorAll("button, a"));
      const btn = butonlar.find(b => b.innerText?.toLowerCase().includes("ayrıntılar"));
      if (btn) btn.click();
    });

    await bekle(2000);

    // 6. Açılan popup'tan bilgileri çek
    const bilgiler = await page.evaluate(() => {
      const tumMetin = document.body.innerText;
      console.log("SAYFA:", tumMetin.substring(0, 3000));

      // Ad Soyad — "Alıcı Adı Soyadı / Unvanı" başlığından sonra
      let adSoyad = "";
      const satirlar = tumMetin.split("\n").map(s => s.trim()).filter(s => s);
      for (let i = 0; i < satirlar.length; i++) {
        if (satirlar[i].toLowerCase().includes("alıcı adı soyadı") ||
            satirlar[i].toLowerCase().includes("alıcı adı")) {
          adSoyad = satirlar[i + 1] || "";
          break;
        }
      }

      // Telefon — "Gsm:" formatında
      let telefon = "";
      const gsmMatch = tumMetin.match(/Gsm[:\s]+(\d{10,11})/i);
      if (gsmMatch) {
        telefon = "0" + gsmMatch[1].replace(/^0/, "");
      } else {
        // Normal Türk numarası ara
        const telMatch = tumMetin.match(/(\+90|0)[\s\-]?(5\d{2})[\s\-]?(\d{3})[\s\-]?(\d{2})[\s\-]?(\d{2})/);
        if (telMatch) telefon = telMatch[0].replace(/[\s\-]/g, "");
      }

      return { adSoyad, telefon };
    });

    console.log("📋 Bulunan bilgiler:", bilgiler);
    await browser.close();
    return bilgiler;

  } catch (hata) {
    await browser.close();
    throw hata;
  }
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Kurye botu çalışıyor! Port: ${PORT}`));
